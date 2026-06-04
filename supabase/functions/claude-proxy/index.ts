// Hired — server-side proxy for the Anthropic Messages API.
//
// Why this exists:
//   The Anthropic API key cannot live in a browser bundle (any visitor can
//   extract it and burn credits). This Edge Function holds the key in
//   `Deno.env.get('ANTHROPIC_API_KEY')` and only forwards requests from
//   authenticated Hired users.
//
// Wire-up (one-time):
//   supabase login
//   supabase link --project-ref ihwxptpvgrnazcbciyzw
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy claude-proxy
//
// Request shape (POST, JSON):
//   { systemPrompt: string,
//     userMessage?: string,     // used when `messages` is absent
//     messages?: { role, content }[],   // multi-turn (askAI)
//     fetchUrl?: string,        // if present: server fetches this URL,
//                               // strips HTML, and uses the text as
//                               // userMessage (job-URL parser path).
//     model: string,            // 'claude-haiku-4-5-...' | 'claude-sonnet-4-...'
//     max_tokens?: number }     // default 2000
//
// Response: the raw Anthropic /v1/messages JSON, with usage + content[].
//
// Authn:
//   Client must send Authorization: Bearer <supabase-access-token>.
//   We resolve the user via the auth-helpers client; if no user, 401.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'

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

// ── URL-fetch helpers ──────────────────────────────────────────────────
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
}

async function tryDirectFetch(url: string): Promise<string> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: controller.signal })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const html = await res.text()
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } finally {
    clearTimeout(t)
  }
}

// Firecrawl: scrapes the page with a real headless browser and strong
// anti-bot bypassing, returning clean markdown. Far more reliable than a
// plain fetch (or the old Jina Reader) on Greenhouse, Lever, Workday, and
// most company career pages. Requires the FIRECRAWL_API_KEY secret.
async function tryFirecrawl(url: string): Promise<string> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY')
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set')

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ['markdown'] }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Firecrawl ${res.status}`)
    const body = await res.json()
    // v1/scrape shape: { success: boolean, data: { markdown, metadata, ... } }
    const markdown = body?.data?.markdown
    if (typeof markdown !== 'string' || !markdown.trim()) {
      throw new Error('Firecrawl returned no markdown')
    }
    return trimBoilerplate(markdown.trim())
  } finally {
    clearTimeout(t)
  }
}

// Cut off boilerplate that commonly comes AFTER the real job content
// (cookie consent, "similar jobs", etc.) so the model sees mostly the
// actual posting. Source-agnostic — works on any markdown.
function trimBoilerplate(raw: string): string {
  const endMarkers: RegExp[] = [
    /^##\s*Cookies on this site/im,
    /^##\s*Get notified for similar jobs/im,
    /^##\s*Similar Jobs/im,
    /^##\s*Related Jobs/im,
    /^##\s*Profile recommendations/im,
    /^##\s*Jobseekers Also Viewed/im,
    /^##\s*Jobs based on your browsing history/im,
    /^##\s*People also searched/im,
  ]
  let cutAt = raw.length
  for (const re of endMarkers) {
    const m = re.exec(raw)
    if (m && m.index < cutAt) cutAt = m.index
  }
  return raw.slice(0, cutAt).trim()
}

// Heuristic: a JS-rendered SPA shell typically has very little text and/or
// is littered with template placeholders like `${...}`, `{{ ... }}` that
// would normally be filled in by client-side JavaScript. Even a handful
// of unfilled placeholders strongly signals an unrendered SPA.
function looksLikeSpaShell(text: string): boolean {
  if (text.length < 1500) return true
  const placeholders = (text.match(/\$\{[^}]+\}|\{\{[^}]+\}\}/g) || []).length
  if (placeholders > 10) return true
  // Whitespace-dominant page (collapsed many empty divs): if more than
  // 50% of the post-collapse content is whitespace, treat as shell.
  const whitespaceRatio = (text.match(/\s/g) || []).length / text.length
  if (whitespaceRatio > 0.6) return true
  return false
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // ── Authenticate caller ──────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    return json({ error: 'Missing Authorization bearer token' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !supabaseAnon) {
    return json({ error: 'Server is missing SUPABASE_URL or SUPABASE_ANON_KEY' }, 500)
  }

  // Pass the user's JWT through so RLS-style identity checks resolve to them.
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) {
    return json({ error: 'Invalid or expired session' }, 401)
  }

  // ── Parse + validate body ────────────────────────────────────────────
  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }

  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : null
  let userMessage = typeof body.userMessage === 'string' ? body.userMessage : null
  let messages = Array.isArray(body.messages) ? body.messages : null
  const fetchUrl = typeof body.fetchUrl === 'string' ? body.fetchUrl : null
  // PDF input — base64 + mime, used for the AI resume importer. Anthropic's
  // /v1/messages accepts a `document` content block with base64 PDFs (no
  // extra extraction libs needed on our side).
  const pdfBase64 = typeof body.pdfBase64 === 'string' ? body.pdfBase64 : null
  const pdfMime = typeof body.pdfMime === 'string' ? body.pdfMime : 'application/pdf'
  const model = typeof body.model === 'string' ? body.model : null
  const maxTokens = Number.isFinite(body.max_tokens) ? body.max_tokens : 2000

  if (!systemPrompt) return json({ error: 'systemPrompt is required' }, 400)
  if (!model)        return json({ error: 'model is required' }, 400)
  if (!messages && !userMessage && !fetchUrl && !pdfBase64) {
    return json({ error: 'Provide `userMessage`, `messages`, `fetchUrl`, or `pdfBase64`' }, 400)
  }

  // ── PDF input path (resume importer) ────────────────────────────────
  // Build a single user message containing a `document` block + the
  // accompanying text instruction. We do this before the generic payload
  // assembly below.
  if (pdfBase64 && !messages) {
    const userInstruction = userMessage || 'Parse the attached resume.'
    messages = [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: pdfMime, data: pdfBase64 } },
        { type: 'text', text: userInstruction },
      ],
    }]
  }

  // ── Optional: server-side URL fetch (job-URL parser path) ────────────
  //
  // Strategy: try a plain HTTP GET first (fast, works for plain HTML pages
  // like Lever / Greenhouse / company career pages). If the result looks
  // like a JavaScript SPA shell — short or full of unfilled template
  // placeholders — fall back to Firecrawl, which scrapes with a real
  // headless browser and strong anti-bot bypassing, returning clean markdown.
  if (fetchUrl) {
    let text: string | null = null
    try {
      text = await tryDirectFetch(fetchUrl)
    } catch (_) { /* fall through to Firecrawl */ }

    if (!text || looksLikeSpaShell(text)) {
      try {
        text = await tryFirecrawl(fetchUrl)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return json({ error: `Could not read the page: ${msg}` }, 502)
      }
    }

    if (!text || text.length < 80) {
      return json({ error: 'The page had too little readable text. Try a direct posting link.' }, 422)
    }
    // 20k chars is well under Haiku's input budget but big enough that we
    // include the full job content even for pages with lots of navigation/footer.
    userMessage = text.slice(0, 20_000)
  }

  // ── Forward to Anthropic ─────────────────────────────────────────────
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ error: 'Server is missing ANTHROPIC_API_KEY secret' }, 500)
  }

  const payload = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages ?? [{ role: 'user', content: userMessage }],
  }

  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    return json({ error: `Failed to reach Anthropic: ${(err as Error).message}` }, 502)
  }

  // Mirror Anthropic's status code so client code can read it; always include CORS.
  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...CORS_HEADERS,
      'content-type': upstream.headers.get('content-type') || 'application/json',
    },
  })
})
