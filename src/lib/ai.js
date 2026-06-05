/**
 * @file Master AI config + utilities.
 *
 * Exports:
 *   - MODELS         — model id constants (fast / smart)
 *   - TIER_LIMITS    — per-tier feature quotas (-1 unlimited, 0 locked)
 *   - callClaude     — POST to Anthropic /v1/messages and return text
 *   - trackUsage     — insert a row into the `ai_usage` table (never throws)
 *   - checkLimit     — return { allowed, remaining, limit } for a feature/tier
 *
 * @module lib/ai
 */
// All Claude calls go through the `claude-proxy` Supabase Edge Function,
// which holds the Anthropic API key as a server-side secret. The browser
// never sees the key — it just attaches the user's Supabase JWT and the
// function proxies the request to Anthropic.

import { supabase } from './supabase'

export const MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  // Sonnet 4.6 — used for higher-fidelity work (resume parsing from PDF,
  // tailoring, prep generation). The old `claude-sonnet-4-20250514` id
  // 404'd from the proxy.
  smart: 'claude-sonnet-4-6',
}

// -1 = unlimited, 0 = locked
export const TIER_LIMITS = {
  free: {
    job_parses: 5,          // monthly
    email_parses: 10,       // monthly
    email_replies: 3,       // lifetime
    ats_scores: 3,          // monthly
    resume_tailoring: 1,    // lifetime
    resume_imports: 1,      // lifetime — AI parsing of an uploaded resume PDF
    resume_versions: 3,     // total active
    interview_prep: 2,      // monthly
    community_intel: 0,     // locked
    ask_ai_per_day: 5,      // daily
    nudges: 0,              // locked — AI nudges are a Pro/Elite feature
    peer_comparisons: 0,    // locked
    job_match_score: 0,     // locked
  },
  pro: {
    job_parses: -1,
    email_parses: -1,
    email_replies: 20,
    ats_scores: -1,
    resume_tailoring: 5,
    resume_imports: 10,
    resume_versions: 10,
    interview_prep: 10,
    community_intel: 0,
    ask_ai_per_day: -1,
    nudges: 20,             // monthly
    peer_comparisons: 0,
    job_match_score: -1,
  },
  elite: {
    job_parses: -1,
    email_parses: -1,
    email_replies: -1,
    ats_scores: -1,
    resume_tailoring: -1,
    resume_imports: -1,
    resume_versions: -1,
    interview_prep: -1,
    community_intel: -1,
    ask_ai_per_day: -1,
    nudges: -1,
    peer_comparisons: -1,
    job_match_score: -1,
  },
}

// Which features reset monthly vs. daily vs. lifetime — used by checkLimit.
const PERIOD_BY_FEATURE = {
  job_parses: 'month',
  email_parses: 'month',
  ats_scores: 'month',
  interview_prep: 'month',
  ask_ai_per_day: 'day',
  email_replies: 'all',
  resume_tailoring: 'all',
  resume_imports: 'all',
  // resume_versions / nudges are "total active" — caller computes those
  // from the resumes / ai_nudges tables, not from ai_usage history.
}

// Resolves to the deployed Edge Function URL.
// e.g. https://ihwxptpvgrnazcbciyzw.supabase.co/functions/v1/claude-proxy
function proxyUrl() {
  const base = import.meta.env.VITE_SUPABASE_URL
  if (!base) throw new Error('VITE_SUPABASE_URL is not set')
  return `${base.replace(/\/$/, '')}/functions/v1/claude-proxy`
}

// Internal helper — also used by `askAI.js` when it needs to pass a
// multi-turn `messages` array. `payload` can include `messages` (array)
// instead of `userMessage` (string).
export async function callProxy(payload) {
  const { data: sessionData, error: sessErr } = await supabase.auth.getSession()
  if (sessErr) throw new Error(`Could not read auth session: ${sessErr.message}`)
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('You must be signed in to use AI features.')

  let res
  try {
    res = await fetch(proxyUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    throw new Error(`AI request failed to send: ${err.message}`)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.error?.message || body?.error || JSON.stringify(body)
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(`AI proxy ${res.status}: ${detail || res.statusText}`)
  }

  return res.json()
}

// Bulletproof JSON extraction. Models sometimes wrap responses in
// markdown fences, prefix with explanation, or include trailing notes.
// We find the outermost {...} or [...] and parse just that.
export function extractJson(raw) {
  if (typeof raw !== 'string') throw new Error('Expected string')
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()

  const firstObj = cleaned.indexOf('{')
  const firstArr = cleaned.indexOf('[')
  let start, openCh, closeCh
  if (firstObj === -1 && firstArr === -1) throw new Error('No JSON found in response')
  if (firstArr === -1 || (firstObj !== -1 && firstObj < firstArr)) {
    start = firstObj; openCh = '{'; closeCh = '}'
  } else {
    start = firstArr; openCh = '['; closeCh = ']'
  }

  let depth = 0, inString = false, escape = false, end = -1
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (escape) { escape = false; continue }
    if (c === '\\') { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === openCh) depth++
    else if (c === closeCh) {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) throw new Error('Unbalanced JSON in response')
  return JSON.parse(cleaned.slice(start, end + 1))
}

export async function callClaude(systemPrompt, userMessage, model = MODELS.fast) {
  const data = await callProxy({ systemPrompt, userMessage, model, max_tokens: 2000 })
  const text = data?.content?.[0]?.text
  if (typeof text !== 'string') {
    throw new Error('AI response did not include text content')
  }
  callClaude.lastUsage = {
    inputTokens: data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.output_tokens || 0,
    model,
  }
  return text
}

const PRICING = {
  haiku:  { input: 0.000001, output: 0.000005 },
  sonnet: { input: 0.000003, output: 0.000015 },
}

function modelFamily(model) {
  if (!model) return 'haiku'
  return model.includes('sonnet') ? 'sonnet' : 'haiku'
}

export async function trackUsage(userId, feature, model, inputTokens, outputTokens, applicationId = null) {
  try {
    if (!userId || !feature) return
    const fam = modelFamily(model)
    const p = PRICING[fam]
    const cost = (Number(inputTokens) || 0) * p.input + (Number(outputTokens) || 0) * p.output
    await supabase.from('ai_usage').insert({
      user_id: userId,
      feature,
      model,
      input_tokens: Number(inputTokens) || 0,
      output_tokens: Number(outputTokens) || 0,
      cost_usd: Number(cost.toFixed(6)),
      application_id: applicationId,
    })
  } catch (err) {
    // Never throw — usage tracking is best-effort.
    console.warn('trackUsage failed (silent):', err?.message || err)
  }
}

function periodStart(period) {
  const now = new Date()
  if (period === 'day') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  }
  if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  }
  // 'all' → epoch
  return new Date(0).toISOString()
}

export async function checkLimit(userId, feature, tier = 'free') {
  const tierLimits = TIER_LIMITS[tier] || TIER_LIMITS.free
  const limit = tierLimits[feature]

  if (limit === -1) return { allowed: true, remaining: -1, limit: -1 }
  if (limit === 0)  return { allowed: false, remaining: 0, limit: 0 }
  if (limit == null) return { allowed: true, remaining: -1, limit: -1 }

  const period = PERIOD_BY_FEATURE[feature] || 'month'
  const since = periodStart(period)

  let q = supabase
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('feature', feature)
  if (period !== 'all') q = q.gte('created_at', since)

  const { count, error } = await q
  if (error) {
    // Fail open so a transient DB error doesn't block UX.
    console.warn('checkLimit query failed:', error.message)
    return { allowed: true, remaining: limit, limit }
  }
  const used = count || 0
  const remaining = Math.max(0, limit - used)
  return { allowed: remaining > 0, remaining, limit }
}
