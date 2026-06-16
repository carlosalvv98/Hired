/**
 * @file Master AI config + utilities.
 *
 * Exports:
 *   - MODELS         — model id constants (fast / smart)
 *   - getTierLimits  — load per-tier feature quotas from the `tier_limits` DB
 *                      table (-1 unlimited, 0 locked); the single source of truth
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

// Tier limits live in the `tier_limits` DB table (one row per tier+feature:
// limit_value -1 = unlimited, 0 = locked, plus a reset `period`). The table is
// the single source of truth — edit limits there, no deploy needed. We load it
// once and cache it for the session.
//
// Maps the table's `period` vocabulary to what periodStart() understands.
// resume_versions / nudges are "total active" counts the caller computes from
// other tables, not from ai_usage — they map to 'all' here harmlessly.
const PERIOD_MAP = { daily: 'day', monthly: 'month', lifetime: 'all', total_active: 'all' }

let _tierLimitsPromise = null

/**
 * Load all tier limits from the DB, shaped as
 * `{ [tier]: { [feature]: { limit:number, period:string } } }`.
 * Cached for the session; falls back to refetch if the load failed/was empty.
 */
export async function getTierLimits() {
  if (_tierLimitsPromise) return _tierLimitsPromise
  _tierLimitsPromise = (async () => {
    const { data, error } = await supabase
      .from('tier_limits')
      .select('tier, feature, limit_value, period')
    if (error || !data || data.length === 0) {
      // Don't cache a failed/empty load — let the next call retry.
      _tierLimitsPromise = null
      if (error) console.warn('getTierLimits failed:', error.message)
      return {}
    }
    const map = {}
    for (const r of data) {
      (map[r.tier] ||= {})[r.feature] = {
        limit: r.limit_value,
        period: PERIOD_MAP[r.period] || 'month',
      }
    }
    return map
  })()
  return _tierLimitsPromise
}

// Drop the cached limits so the next checkLimit re-reads the table (use after
// editing limits, e.g. from an admin screen).
export function clearTierLimitsCache() { _tierLimitsPromise = null }

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
  const all = await getTierLimits()
  const entry = (all[tier] || all.free || {})[feature]
  const limit = entry ? entry.limit : null

  if (limit === -1) return { allowed: true, remaining: -1, limit: -1 }
  if (limit === 0)  return { allowed: false, remaining: 0, limit: 0 }
  // Unknown feature (not in the table) or limits unavailable → fail open.
  if (limit == null) return { allowed: true, remaining: -1, limit: -1 }

  const period = entry.period || 'month'
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
