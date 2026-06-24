// Hired — outbound-email sender (Postmark Send API).
//
// What this does:
//   Sends an email FROM the authenticated user's [handle]@frwdstep.com
//   address via Postmark, optionally with attachments, and saves a copy into
//   the `emails` table (folder 'sent'). It also:
//     - saves drafts without sending (folder 'draft')
//     - saves the user's content even if Postmark rejects it (folder 'failed')
//     - wires thread_id so replies group with their original (E3.5c threading)
//     - bumps the linked application's last_activity_at
//
// Unlike email-inbound (a public Postmark webhook), this function REQUIRES a
// user JWT — the frontend calls it with the user's Supabase session, exactly
// like claude-proxy. RLS on `emails` (auth.uid() = user_id) lets the user's
// own JWT do every insert/update here, so we never need the service-role key.
//
// Wire-up (one-time):
//   supabase secrets set POSTMARK_SERVER_TOKEN=...   (already set)
//   supabase functions deploy email-outbound          (verify-jwt ON — default)
//
// Request shape (POST, JSON):
//   { to: string[], cc?: string[], subject: string,
//     html_body?: string, text_body?: string,
//     in_reply_to?: string,            // original Message-ID, for replies
//     thread_id?: string | null,       // existing thread to attach to
//     application_id?: string | null,  // tracker app to keep fresh
//     attachments?: { name, content_type, content_base64 }[],
//     is_draft?: boolean }
//
// Response:
//   send ok    → { success: true, email_id, message_id }
//   draft      → { success: true, email_id, draft: true }
//   send fail  → { success: false, error, email_id } (502; row saved 'failed')

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const POSTMARK_ENDPOINT = 'https://api.postmarkapp.com/email'
const ATTACHMENT_BUCKET = 'email-attachments'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}

// Decode a base64 string (tolerating whitespace/newlines) to raw bytes for
// Storage upload. Postmark sends/receives attachment content as base64.
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob((b64 || '').replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

type AttachmentInput = { name?: string; content_type?: string; content_base64?: string }
type AttachmentRef = { name: string; path: string; content_type: string; size: number }

// Upload each attachment to {user_id}/{email_id}/{filename} and return the
// stored references for the email's parse_json. Best-effort per file: a single
// upload failure is logged and skipped rather than aborting the whole send.
async function storeAttachments(
  supabase: any, userId: string, emailId: string, attachments: AttachmentInput[],
): Promise<AttachmentRef[]> {
  const refs: AttachmentRef[] = []
  for (const a of attachments) {
    const name = (a?.name || 'attachment').replace(/[/\\]/g, '_')
    if (!a?.content_base64) continue
    try {
      const bytes = base64ToBytes(a.content_base64)
      const path = `${userId}/${emailId}/${name}`
      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, bytes, {
          contentType: a.content_type || 'application/octet-stream',
          upsert: true,
        })
      if (error) throw error
      refs.push({
        name,
        path,
        content_type: a.content_type || 'application/octet-stream',
        size: bytes.length,
      })
    } catch (err) {
      console.error(`[email-outbound] attachment "${name}" upload failed:`, (err as Error).message)
    }
  }
  return refs
}

Deno.serve(async (req) => {
  // CORS preflight — mirrors claude-proxy.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // ── Authenticate caller (user JWT) ───────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return json({ error: 'Missing Authorization bearer token' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !supabaseAnon) {
    return json({ error: 'Server is missing SUPABASE_URL or SUPABASE_ANON_KEY' }, 500)
  }

  // The user's JWT rides on every request, so RLS resolves auth.uid() to them
  // and authorizes the email insert/updates + own-prefix storage uploads.
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) {
    return json({ error: 'Invalid or expired session' }, 401)
  }
  const userId = userData.user.id

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }

  const to: string[] = Array.isArray(body.to) ? body.to.filter((s: unknown) => typeof s === 'string' && s.trim()) : []
  const cc: string[] = Array.isArray(body.cc) ? body.cc.filter((s: unknown) => typeof s === 'string' && s.trim()) : []
  const subject: string = typeof body.subject === 'string' ? body.subject : ''
  const htmlBody: string | null = typeof body.html_body === 'string' ? body.html_body : null
  const textBody: string | null = typeof body.text_body === 'string' ? body.text_body : null
  const inReplyTo: string = typeof body.in_reply_to === 'string' ? body.in_reply_to.trim() : ''
  const applicationId: string | null = typeof body.application_id === 'string' ? body.application_id : null
  const attachments: AttachmentInput[] = Array.isArray(body.attachments) ? body.attachments : []
  const isDraft = body.is_draft === true

  // A real send needs at least one recipient; drafts may be empty (auto-save).
  if (!isDraft && to.length === 0) {
    return json({ error: 'At least one `to` recipient is required' }, 400)
  }

  // ── Fetch the sender identity (FROM address + display name) ──────────────
  const { data: userRow, error: rowErr } = await supabase
    .from('users')
    .select('name, forwarding_address')
    .eq('id', userId)
    .single()
  if (rowErr || !userRow) {
    return json({ error: 'Could not load your account' }, 500)
  }
  if (!userRow.forwarding_address) {
    return json({ error: 'Your account has no forwarding address set up yet' }, 400)
  }
  const fromAddress: string = userRow.forwarding_address
  const fromName: string | null = userRow.name || null

  // Generate the email id up-front so attachment storage paths can reference
  // it before the row is inserted.
  const emailId = crypto.randomUUID()
  // thread_id: reuse the provided thread, else start a fresh one. New replies
  // and brand-new emails both end up with a stable thread to group on.
  const threadId: string = (typeof body.thread_id === 'string' && body.thread_id) || crypto.randomUUID()

  // Upload attachments first (for drafts and sends alike) so the saved row
  // always references the stored copies.
  const attachmentRefs = attachments.length
    ? await storeAttachments(supabase, userId, emailId, attachments)
    : []

  const baseRow = {
    id: emailId,
    user_id: userId,
    mailbox_source: 'hired_forward',
    thread_id: threadId,
    from_email: fromAddress,
    from_name: fromName,
    to_addresses: to,
    cc_addresses: cc,
    subject,
    received_at: new Date().toISOString(), // sent/saved timestamp
    body_text: textBody,
    body_html: htmlBody,
    snippet: textBody ? textBody.trim().slice(0, 150) : null,
    parse_status: 'parsed',
    is_unread: false,
    is_starred: false,
    linked_application_id: applicationId,
  }

  // ── Draft path: save only, never send ────────────────────────────────────
  if (isDraft) {
    const { data: saved, error } = await supabase
      .from('emails')
      .insert({
        ...baseRow,
        provider_message_id: null,
        folder: 'draft',
        parse_json: { email_type: 'sent', sent_by_user: true, draft: true, attachments: attachmentRefs },
      })
      .select('id')
      .single()
    if (error) {
      console.error('[email-outbound] draft save failed:', error.message)
      return json({ success: false, error: 'Failed to save draft' }, 500)
    }
    return json({ success: true, email_id: saved.id, draft: true })
  }

  // ── Send via Postmark ────────────────────────────────────────────────────
  const postmarkToken = Deno.env.get('POSTMARK_SERVER_TOKEN')
  if (!postmarkToken) {
    return json({ success: false, error: 'Server is missing POSTMARK_SERVER_TOKEN' }, 500)
  }

  // Only include In-Reply-To / References when we actually have a parent id;
  // Postmark rejects empty header values.
  const headers = inReplyTo
    ? [
        { Name: 'In-Reply-To', Value: inReplyTo },
        { Name: 'References', Value: inReplyTo },
      ]
    : []

  const postmarkPayload: Record<string, unknown> = {
    From: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
    To: to.join(', '),
    Subject: subject,
    HtmlBody: htmlBody || undefined,
    TextBody: textBody || undefined,
    MessageStream: 'outbound',
    Headers: headers,
    Attachments: attachments
      .filter((a) => a?.content_base64)
      .map((a) => ({
        Name: (a.name || 'attachment').replace(/[/\\]/g, '_'),
        Content: a.content_base64,
        ContentType: a.content_type || 'application/octet-stream',
      })),
  }
  if (cc.length) postmarkPayload.Cc = cc.join(', ')

  let messageId: string | null = null
  let sendError: string | null = null
  try {
    const resp = await fetch(POSTMARK_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': postmarkToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(postmarkPayload),
    })
    const result = await resp.json().catch(() => ({}))
    // Postmark signals failure with a non-zero ErrorCode even on HTTP 200.
    if (!resp.ok || (result?.ErrorCode && result.ErrorCode !== 0)) {
      sendError = result?.Message || `Postmark HTTP ${resp.status}`
    } else {
      messageId = result?.MessageID || null
    }
  } catch (err) {
    sendError = (err as Error).message
  }

  // ── Save the email (sent, or failed so the user keeps their work) ────────
  const folder = sendError ? 'failed' : 'sent'
  const { data: saved, error: insertErr } = await supabase
    .from('emails')
    .insert({
      ...baseRow,
      provider_message_id: messageId,
      folder,
      parse_json: {
        email_type: 'sent',
        sent_by_user: true,
        attachments: attachmentRefs,
        ...(sendError ? { send_error: sendError } : {}),
      },
    })
    .select('id')
    .single()

  if (insertErr) {
    console.error('[email-outbound] email insert failed:', insertErr.message)
    // The send may have succeeded but we couldn't persist — report honestly.
    return json({
      success: !sendError,
      error: sendError || 'Email sent but could not be saved',
      message_id: messageId,
    }, sendError ? 502 : 500)
  }

  if (sendError) {
    console.error(`[email-outbound] Postmark rejected email ${saved.id}: ${sendError}`)
    return json({ success: false, error: 'Failed to send', email_id: saved.id }, 502)
  }

  // ── Thread wiring: backfill the original email's thread_id on a reply ────
  // The reply now owns `threadId`; link the parent (matched by its Message-ID)
  // if it isn't already threaded, so the conversation groups together.
  if (inReplyTo) {
    try {
      await supabase
        .from('emails')
        .update({ thread_id: threadId })
        .eq('user_id', userId)
        .eq('provider_message_id', inReplyTo)
        .is('thread_id', null)
    } catch (err) {
      console.error('[email-outbound] thread backfill failed:', (err as Error).message)
    }
  }

  // ── Keep the linked application's activity fresh ──────────────────────────
  if (applicationId) {
    try {
      await supabase
        .from('applications')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', applicationId)
    } catch (err) {
      console.error('[email-outbound] application bump failed:', (err as Error).message)
    }
  }

  console.log(`[email-outbound] sent email ${saved.id} (msg ${messageId}) for user ${userId}`)
  return json({ success: true, email_id: saved.id, message_id: messageId })
})
