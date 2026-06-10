// Hired — Postmark inbound-email webhook receiver.
//
// What this does:
//   Postmark catches every email sent to a user's [handle]@frwdstep.com
//   address and POSTs it here as JSON. We:
//     1. Match the recipient address to a Hired user (forwarding_address)
//     2. Save the raw email into the `emails` table
//     3. Ask Claude Haiku to parse it into structured JSON
//     4. Stamp the parse result back onto the email row
//
// This function is PUBLIC (Postmark cannot send a Supabase JWT). It uses the
// service-role key to read/write the DB and the Anthropic key to parse. It
// almost always returns 200 — Postmark retries on any non-200, and we don't
// want retries for "no matching user" or "duplicate delivery".
//
// Wire-up (one-time):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...   (usually preset)
//   supabase functions deploy email-inbound --no-verify-jwt
//
// NOTE: deploy with --no-verify-jwt so Supabase doesn't reject Postmark's
// unauthenticated POST at the gateway before our handler runs.
//
// Out of scope here (handled in later tasks): linking the email to an
// application, auto-advancing stages, creating contacts, writing-style
// extraction. This function only saves + parses.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
const PARSE_MODEL = 'claude-haiku-4-5-20251001'
const PROJECT_URL = 'https://ihwxptpvgrnazcbciyzw.supabase.co'

// Sender domains that tell us nothing about the hiring company.
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const PARSE_SYSTEM_PROMPT = `You are an email parser for a job search app. Analyze this inbound email and extract structured information. Respond ONLY in JSON, no markdown fences:
{
  "email_type": "recruiter_reply" | "interview_invite" | "rejection" | "offer" | "follow_up" | "automated" | "newsletter" | "unknown",
  "stage_signal": "screen" | "iv" | "final" | "offer" | "reject" | "ghost" | null,
  "confidence": 0.0 to 1.0,
  "company_name": "extracted company name" | null,
  "company_domain": "company.com" | null,
  "contact_name": "sender's name" | null,
  "contact_role": "Recruiter" | "Hiring Manager" | etc | null,
  "role_mentioned": "job title mentioned in email" | null,
  "interview_date": "ISO datetime if mentioned" | null,
  "interview_type": "phone" | "video" | "onsite" | "technical" | "behavioral" | null,
  "action_needed": true | false,
  "action_summary": "brief description of what user should do" | null,
  "sentiment": "positive" | "neutral" | "negative",
  "summary": "1-2 sentence summary of the email"
}

Rules:
- If a field is not clearly present in the email, return null.
- Never guess or invent information.
- company_domain should be extracted from the sender's email domain (e.g., sarah@google.com -> google.com). Skip generic domains like gmail.com, outlook.com, yahoo.com.
- confidence reflects how sure you are about the stage_signal.
- automated emails (no-reply, system notifications) should be type "automated" with low confidence.
- For interview invites, try to extract the date/time and type.`

// Pull the outermost JSON object out of the model's response, tolerating
// stray prose or accidental ```json fences. Mirrors lib/ai.js#extractJson.
function extractJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error('No JSON object in response')
  let depth = 0, inString = false, escape = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (escape) { escape = false; continue }
    if (c === '\\') { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1))
    }
  }
  throw new Error('Unbalanced JSON in response')
}

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at === -1) return null
  const d = email.slice(at + 1).trim().toLowerCase()
  if (!d || GENERIC_DOMAINS.has(d)) return null
  return d
}

// Postmark's `To` header can be "Name <addr>" or a bare address. Prefer the
// parsed ToFull[].Email list, fall back to scraping the raw header.
function recipientCandidates(payload: any): string[] {
  const out: string[] = []
  if (Array.isArray(payload.ToFull)) {
    for (const t of payload.ToFull) {
      if (t?.Email) out.push(String(t.Email).trim())
    }
  }
  if (typeof payload.To === 'string' && payload.To.trim()) {
    const m = payload.To.match(/<([^>]+)>/)
    out.push((m ? m[1] : payload.To).trim())
  }
  // De-dupe, drop empties.
  return [...new Set(out.filter(Boolean))]
}

// ── Auto-action helpers (E2) ───────────────────────────────────────────────

// Forward-only stage progression. reject/ghost may be reached from any stage;
// everything else can only advance to a later index in this ladder.
const STAGE_ORDER = ['new', 'applied', 'screen', 'iv', 'final', 'offer', 'accepted']
const SIDE_STAGES = new Set(['reject', 'ghost'])

// Email types that may auto-create a stub application. Newsletters / automated
// system mail should never spawn tracker entries.
const JOB_RELEVANT_TYPES = new Set([
  'recruiter_reply', 'interview_invite', 'rejection', 'offer', 'follow_up', 'unknown',
])

// Generic role-title words that carry no matching signal on their own.
const ROLE_STOPWORDS = new Set([
  'senior', 'junior', 'staff', 'lead', 'principal', 'sr', 'jr', 'i', 'ii', 'iii',
  'engineer', 'manager', 'developer', 'specialist', 'analyst', 'associate',
  'the', 'of', 'and', 'a', 'an', 'for', 'to', 'role', 'position', 'team',
])

function norm(s: unknown): string {
  return typeof s === 'string' ? s.trim().toLowerCase() : ''
}

// True if the two role strings share at least one *significant* token.
function roleWordsOverlap(a: string, b: string): boolean {
  const toks = (s: string) =>
    new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !ROLE_STOPWORDS.has(w)))
  const A = toks(a)
  if (A.size === 0) return false
  for (const w of toks(b)) if (A.has(w)) return true
  return false
}

// Map the model's freeform contact_role to the contacts.role CHECK enum.
function mapContactRole(role: unknown): string | null {
  const r = norm(role)
  if (!r) return null
  if (r.includes('recruit') || r.includes('talent') || r.includes('sourcer')) return 'recruiter'
  if (r.includes('hiring')) return 'hiring_manager'
  if (r.includes('refer')) return 'referrer'
  if (r.includes('interview')) return 'interviewer'
  return 'other'
}

// Pull the first meeting URL out of an email body (Zoom / Meet / Teams /
// anything that looks like a join link). Returns null if none found.
function extractMeetingUrl(body: string | null | undefined): string | null {
  if (!body) return null
  const urls = body.match(/https?:\/\/[^\s<>"')]+/gi) || []
  const specific = urls.find(u =>
    /zoom\.us\/(j|meeting|w)\//i.test(u) ||
    /meet\.google\.com\//i.test(u) ||
    /teams\.(microsoft|live)\.com\//i.test(u))
  if (specific) return specific
  const generic = urls.find(u => /(meet|join|conference|webinar)/i.test(u))
  return generic || null
}

// Human label for an interview type, used in calendar titles + step titles.
function interviewLabel(type: unknown): string {
  switch (norm(type)) {
    case 'phone':       return 'Phone Screen'
    case 'video':       return 'Video Interview'
    case 'onsite':      return 'Onsite Interview'
    case 'technical':   return 'Technical Interview'
    case 'behavioral':  return 'Behavioral Interview'
    default:            return 'Interview'
  }
}

// Find a company by domain (preferred) or case-insensitive name, else create
// one. Mirrors the client-side findOrCreateCompany used by the job parser.
async function findOrCreateCompany(
  supabase: any, name: string | null, domain: string | null,
): Promise<string | null> {
  const cleanName = name && name.trim() ? name.trim() : null
  const cleanDomain = domain && domain.trim() ? domain.trim().toLowerCase() : null
  if (!cleanName && !cleanDomain) return null

  if (cleanDomain) {
    const { data } = await supabase.from('companies').select('id').eq('domain', cleanDomain).maybeSingle()
    if (data) return data.id
  }
  if (cleanName) {
    const { data } = await supabase.from('companies').select('id').ilike('name', cleanName).maybeSingle()
    if (data) {
      // Backfill a learned domain onto the existing company if it had none.
      if (cleanDomain) {
        await supabase.from('companies').update({ domain: cleanDomain }).eq('id', data.id).is('domain', null)
      }
      return data.id
    }
  }
  const { data: created, error } = await supabase
    .from('companies')
    .insert({ name: cleanName || cleanDomain, domain: cleanDomain })
    .select('id')
    .single()
  if (error) {
    // Likely a unique-domain race — re-read by domain.
    if (cleanDomain) {
      const { data } = await supabase.from('companies').select('id').eq('domain', cleanDomain).maybeSingle()
      if (data) return data.id
    }
    throw error
  }
  return created.id
}

Deno.serve(async (req) => {
  console.log(`[email-inbound] ${req.method} request received`)

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let payload: any
  try {
    payload = await req.json()
  } catch {
    // Not JSON at all — treat as a probe/health check, don't make Postmark retry.
    console.log('[email-inbound] body was not JSON — returning 200 (health check)')
    return json({ success: true, skipped: 'non-json-body' }, 200)
  }

  // Empty payload / health check.
  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    console.log('[email-inbound] empty payload — returning 200 (health check)')
    return json({ success: true, skipped: 'empty-payload' }, 200)
  }

  // Validate this looks like a Postmark inbound payload before doing work.
  const hasShape = payload.From && (payload.To || Array.isArray(payload.ToFull)) &&
    'Subject' in payload && payload.MessageID
  if (!hasShape) {
    console.warn('[email-inbound] payload missing required Postmark fields — ignoring')
    return json({ success: true, skipped: 'not-a-postmark-payload' }, 200)
  }

  // ── Service-role Supabase client (no user JWT — Postmark calls us) ───────
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || PROJECT_URL
  if (!serviceKey) {
    // Genuine server misconfig — let Postmark retry.
    console.error('[email-inbound] SUPABASE_SERVICE_ROLE_KEY is not set')
    return json({ error: 'Server missing service role key' }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── Match recipient to a user (case-insensitive) ────────────────────────
  const candidates = recipientCandidates(payload)
  let user: { id: string } | null = null
  for (const addr of candidates) {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .ilike('forwarding_address', addr)
      .maybeSingle()
    if (error) {
      console.error('[email-inbound] user lookup error:', error.message)
      continue
    }
    if (data) { user = data; break }
  }

  if (!user) {
    console.warn(`[email-inbound] no user for recipients [${candidates.join(', ')}] — returning 200`)
    return json({ success: true, skipped: 'no-matching-user' }, 200)
  }

  // ── Idempotency: skip if we already stored this MessageID ───────────────
  const messageId = String(payload.MessageID)
  const { data: existing } = await supabase
    .from('emails')
    .select('id')
    .eq('user_id', user.id)
    .eq('provider_message_id', messageId)
    .maybeSingle()
  if (existing) {
    console.log(`[email-inbound] duplicate MessageID ${messageId} — returning existing email ${existing.id}`)
    return json({ success: true, email_id: existing.id, duplicate: true }, 200)
  }

  // ── Save the raw email ──────────────────────────────────────────────────
  const textBody: string = payload.TextBody || payload.StrippedTextReply || ''
  let receivedAt = new Date().toISOString()
  if (payload.Date) {
    const d = new Date(payload.Date)
    if (!isNaN(d.getTime())) receivedAt = d.toISOString()
  }

  const insertRow = {
    user_id: user.id,
    // The `emails.mailbox_source` CHECK constraint only allows
    // 'hired_forward' | 'gmail' | 'outlook'. Postmark inbound IS the hired
    // forwarding mechanism, so 'hired_forward' is the correct (and only valid)
    // value here. Provider-level attribution lives in provider_message_id.
    mailbox_source: 'hired_forward',
    provider_message_id: messageId,
    thread_id: null,
    from_email: payload.From,
    from_name: payload.FromName || null,
    to_addresses: Array.isArray(payload.ToFull) ? payload.ToFull.map((t: any) => t.Email).filter(Boolean) : candidates,
    cc_addresses: Array.isArray(payload.CcFull) ? payload.CcFull.map((c: any) => c.Email).filter(Boolean) : [],
    subject: payload.Subject || '',
    received_at: receivedAt,
    body_text: textBody || null,
    body_html: payload.HtmlBody || null,
    snippet: textBody ? textBody.trim().slice(0, 150) : null,
    parse_status: 'pending',
    is_unread: true,
    is_starred: false,
    folder: 'inbox',
  }

  const { data: emailRow, error: insertErr } = await supabase
    .from('emails')
    .insert(insertRow)
    .select()
    .single()

  if (insertErr) {
    // 23505 = unique violation → a duplicate slipped past the pre-check; that's
    // fine, stay idempotent and return 200.
    if ((insertErr as any).code === '23505') {
      console.log('[email-inbound] insert hit unique violation — treating as duplicate')
      return json({ success: true, skipped: 'duplicate-insert' }, 200)
    }
    console.error('[email-inbound] failed to insert email:', insertErr.message)
    return json({ error: 'Failed to save email' }, 500)
  }

  console.log(`[email-inbound] saved email ${emailRow.id} for user ${user.id}`)

  // ── AI parse (best-effort — never blocks the 200) ───────────────────────
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.error('[email-inbound] ANTHROPIC_API_KEY not set — leaving parse_status=pending')
    return json({ success: true, email_id: emailRow.id, parsed: false }, 200)
  }

  const userMessage =
    `From: ${payload.FromName || ''} <${payload.From}>\n` +
    `Subject: ${payload.Subject || '(no subject)'}\n\n` +
    `${textBody || '(no body)'}`

  try {
    const upstream = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: PARSE_MODEL,
        max_tokens: 1024,
        system: PARSE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      throw new Error(`Anthropic ${upstream.status}: ${detail.slice(0, 200)}`)
    }

    const data = await upstream.json()
    const text = data?.content?.[0]?.text
    if (typeof text !== 'string') throw new Error('No text content in Anthropic response')

    const parsed = extractJson(text)

    // Backfill company_domain from the sender if the model didn't provide one.
    if (!parsed.company_domain) {
      const fromDomain = domainOf(payload.From)
      if (fromDomain) parsed.company_domain = fromDomain
    }

    // Run the parse-driven auto-actions. Each is best-effort and isolated, so a
    // failure in one (e.g. contact creation) never blocks the others or the 200.
    await runAutoActions(supabase, { user, emailRow, payload, parsed, textBody })
  } catch (err) {
    // Parse failed — the email is already saved with parse_status='pending',
    // so it can be retried later. Don't fail the webhook.
    console.error('[email-inbound] AI parse failed:', (err as Error).message)
  }

  return json({ success: true, email_id: emailRow.id }, 200)
})

// ── E2: act on the parse result ────────────────────────────────────────────
// Order: link → stage → contact → timeline → calendar. Every step is wrapped
// so partial failure degrades gracefully. The email is already saved + parsed
// by the time we get here; everything below is enhancement.
async function runAutoActions(
  supabase: any,
  ctx: { user: { id: string }; emailRow: any; payload: any; parsed: any; textBody: string },
) {
  const { user, emailRow, payload, parsed, textBody } = ctx
  const fromEmail: string | null = payload.From || null
  const fromName: string | null = payload.FromName || null
  const senderDomain = domainOf(fromEmail)

  let linkedAppId: string | null = null
  let linkedConfidence: number | null = null
  let linkedCompanyId: string | null = null
  let parseStatus = 'parsed'
  let prevStage: string | null = null
  let newStage: string | null = null

  // ── Action 1: fuzzy-match → link (or create a stub) ───────────────────────
  try {
    const { data: apps, error } = await supabase
      .from('applications')
      .select('id, role_title, stage, company_id, company:companies(name, domain)')
      .eq('user_id', user.id)
      .eq('archived', false)
    if (error) throw error

    const pCompanyDomain = norm(parsed.company_domain)
    const pCompanyName = norm(parsed.company_name)
    const pRole = typeof parsed.role_mentioned === 'string' ? parsed.role_mentioned : ''

    let best: any = null
    let bestScore = 0
    for (const a of apps || []) {
      const coName = norm(a.company?.name)
      const coDomain = norm(a.company?.domain)
      let score = 0
      if (pCompanyDomain && coDomain && pCompanyDomain === coDomain) score += 0.5
      if (pCompanyName && coName && (coName.includes(pCompanyName) || pCompanyName.includes(coName))) score += 0.3
      if (pRole && a.role_title && roleWordsOverlap(pRole, a.role_title)) score += 0.2
      if (senderDomain && coDomain && senderDomain === coDomain) score += 0.4
      if (score > bestScore) { bestScore = score; best = a }
    }
    bestScore = Math.min(1, bestScore) // linked_confidence CHECK is 0..1

    if (best && bestScore >= 0.6) {
      linkedAppId = best.id
      linkedConfidence = bestScore
      linkedCompanyId = best.company_id || null
      prevStage = best.stage || null
      // ≥0.85 → confident; 0.6–0.84 → linked but flagged for review.
      parseStatus = bestScore >= 0.85 ? 'parsed' : 'needs_review'
    } else if (JOB_RELEVANT_TYPES.has(norm(parsed.email_type) || 'unknown')) {
      // No good match → create a stub application so the email has a home.
      const companyId = await findOrCreateCompany(
        supabase, parsed.company_name || null, parsed.company_domain || null,
      )
      const { data: stub, error: stubErr } = await supabase
        .from('applications')
        .insert({
          user_id: user.id,
          company_id: companyId,
          role_title: (typeof parsed.role_mentioned === 'string' && parsed.role_mentioned.trim()) || 'Unknown Role',
          stage: 'applied',
          // applications.source CHECK rejects 'email_inbound'; the provenance
          // lives in source_detail + the notes marker instead.
          source: null,
          source_detail: 'email_inbound',
          notes_md: '⚡ Auto-created from inbound email',
          last_activity_at: new Date().toISOString(),
        })
        .select('id, stage, company_id')
        .single()
      if (stubErr) throw stubErr
      linkedAppId = stub.id
      linkedCompanyId = stub.company_id || null
      prevStage = stub.stage
      linkedConfidence = null // no fuzzy basis — it's a fresh stub
      parseStatus = 'needs_review' // surface the auto-created app for the user
      console.log(`[email-inbound] created stub application ${stub.id} from email ${emailRow.id}`)
    }
  } catch (err) {
    console.error('[email-inbound] link/stub action failed:', (err as Error).message)
  }

  // Persist parse result + link in a single update.
  try {
    await supabase
      .from('emails')
      .update({
        parse_status: parseStatus,
        parse_json: parsed,
        linked_application_id: linkedAppId,
        linked_confidence: linkedConfidence,
      })
      .eq('id', emailRow.id)
    console.log(`[email-inbound] email ${emailRow.id} → ${parseStatus}, linked=${linkedAppId ?? 'none'} (conf ${linkedConfidence ?? '—'})`)
  } catch (err) {
    console.error('[email-inbound] failed to persist parse/link:', (err as Error).message)
  }

  // ── Action 2: auto-advance stage (high confidence only) ───────────────────
  const signal = norm(parsed.stage_signal)
  if (linkedAppId && linkedConfidence != null && linkedConfidence >= 0.85 && signal) {
    try {
      const curIdx = STAGE_ORDER.indexOf(prevStage || '')
      const tgtIdx = STAGE_ORDER.indexOf(signal)
      const isForward = tgtIdx > -1 && tgtIdx > curIdx
      const isSide = SIDE_STAGES.has(signal)
      if (isForward || isSide) {
        const patch: any = { stage: signal, last_activity_at: new Date().toISOString() }
        // Stamp applied_at on the first move into 'applied' if not already set.
        if (signal === 'applied') {
          const { data: cur } = await supabase
            .from('applications').select('applied_at').eq('id', linkedAppId).maybeSingle()
          if (cur && !cur.applied_at) patch.applied_at = new Date().toISOString()
        }
        const { error } = await supabase.from('applications').update(patch).eq('id', linkedAppId)
        if (error) throw error
        newStage = signal
        console.log(`[email-inbound] advanced application ${linkedAppId} ${prevStage} → ${signal}`)
      }
    } catch (err) {
      console.error('[email-inbound] stage update failed:', (err as Error).message)
    }
  }

  // ── Action 3: create / update contact ─────────────────────────────────────
  let contactId: string | null = null
  if (parsed.contact_name && fromEmail) {
    try {
      const { data: existing } = await supabase
        .from('contacts').select('id').eq('user_id', user.id).ilike('email', fromEmail).maybeSingle()
      if (existing) {
        contactId = existing.id
        await supabase.from('contacts')
          .update({ last_contacted_at: new Date().toISOString() }).eq('id', existing.id)
      } else {
        const { data: created, error } = await supabase
          .from('contacts')
          .insert({
            user_id: user.id,
            company_id: linkedCompanyId,
            name: String(parsed.contact_name),
            email: fromEmail,
            role: mapContactRole(parsed.contact_role),
            last_contacted_at: new Date().toISOString(),
          })
          .select('id')
          .single()
        if (error) throw error
        contactId = created.id
      }

      // Tie the contact into the application loop (junction PK = app+contact).
      if (contactId && linkedAppId) {
        await supabase.from('application_contacts').upsert({
          application_id: linkedAppId,
          contact_id: contactId,
          role_in_loop: (typeof parsed.contact_role === 'string' && parsed.contact_role) || 'Recruiter',
        }, { onConflict: 'application_id,contact_id', ignoreDuplicates: true })
      }
    } catch (err) {
      console.error('[email-inbound] contact action failed:', (err as Error).message)
    }
  }

  // ── Action 4: timeline events ─────────────────────────────────────────────
  if (linkedAppId) {
    try {
      // application_events.kind CHECK has no 'email_received' → use 'email'.
      // actor CHECK is user/ai/system → 'system'; sender goes in the payload.
      await supabase.from('application_events').insert({
        application_id: linkedAppId,
        kind: 'email',
        actor: 'system',
        at: emailRow.received_at,
        payload_json: {
          email_id: emailRow.id,
          from: fromName || fromEmail,
          subject: payload.Subject || null,
          email_type: parsed.email_type || null,
          summary: parsed.summary || null,
        },
      })
      if (newStage) {
        await supabase.from('application_events').insert({
          application_id: linkedAppId,
          kind: 'stage_change',
          actor: 'system',
          at: new Date().toISOString(),
          payload_json: { from: prevStage, to: newStage, trigger: 'email_auto' },
        })
      }
    } catch (err) {
      console.error('[email-inbound] timeline event failed:', (err as Error).message)
    }
  }

  // ── Action 5: calendar event from an interview invite ─────────────────────
  if (norm(parsed.email_type) === 'interview_invite' && parsed.interview_date) {
    try {
      const start = new Date(parsed.interview_date)
      if (isNaN(start.getTime())) throw new Error(`unparseable interview_date: ${parsed.interview_date}`)
      const end = new Date(start.getTime() + 60 * 60 * 1000) // default 1h
      const meetingUrl = extractMeetingUrl(textBody)
      const companyLabel = (typeof parsed.company_name === 'string' && parsed.company_name) || 'Interview'
      const label = interviewLabel(parsed.interview_type)
      const title = `${label} — ${companyLabel}`

      await supabase.from('calendar_events').insert({
        user_id: user.id,
        application_id: linkedAppId,
        // calendar_events.source CHECK is hired_parsed/gcal/manual → 'hired_parsed'.
        source: 'hired_parsed',
        title,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        // Meeting link lives in the existing location_or_link column (no migration).
        location_or_link: meetingUrl,
      })
      console.log(`[email-inbound] calendar event "${title}" @ ${start.toISOString()}${meetingUrl ? ' (link found)' : ''}`)

      // Mirror onto interview_steps so the drawer ladder reflects the schedule.
      if (linkedAppId) {
        const { data: steps } = await supabase
          .from('interview_steps').select('id, idx, title').eq('application_id', linkedAppId)
        const match = (steps || []).find((s: any) => roleWordsOverlap(s.title || '', label) || norm(s.title) === norm(label))
        if (match) {
          await supabase.from('interview_steps')
            .update({ scheduled_at: start.toISOString() }).eq('id', match.id)
        } else {
          const nextIdx = Math.max(-1, ...((steps || []).map((s: any) => s.idx ?? -1))) + 1
          await supabase.from('interview_steps').insert({
            application_id: linkedAppId,
            idx: nextIdx,
            title: label,
            status: 'pending',
            scheduled_at: start.toISOString(),
          })
        }
      }
    } catch (err) {
      console.error('[email-inbound] calendar/step action failed:', (err as Error).message)
    }
  }
}
