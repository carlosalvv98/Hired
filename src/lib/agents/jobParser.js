/**
 * @file Parses a public job posting URL into a structured object.
 *
 * The Supabase Edge Function fetches the URL server-side (no CORS issues,
 * more reliable than free public proxies) and forwards the cleaned text
 * to Claude Haiku for structured extraction.
 *
 * @module lib/agents/jobParser
 */
import { MODELS, callProxy, extractJson } from '../ai'

// LinkedIn aggressively blocks scrapers (Firecrawl included), so when a
// LinkedIn URL fails we point the user somewhere that actually works
// instead of implying the page-fetch is broken.
function isLinkedInUrl(url) {
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(url).hostname)
  } catch {
    return /linkedin\.com/i.test(String(url))
  }
}

// Friendly, actionable message for when the page-fetch (Firecrawl) returns
// nothing or errors. AddJobModal toasts this and falls through to the manual
// entry form, so the user is never stranded.
function fetchFailureMessage(url) {
  return isLinkedInUrl(url)
    ? 'LinkedIn blocks external tools. Try the direct company careers page instead, or add the job manually.'
    : "Couldn't read that page. Try a direct company careers page link, or add the job manually."
}

const SYSTEM_PROMPT = `You are a job listing parser for a job application tracking app. Extract structured information from job posting text. Return ONLY a valid JSON object with NO markdown, no backticks, no explanation — just raw JSON.

Required fields:
{
  company: string (the hiring company name, NOT the job board or recruiter agency),
  role_title: string (exact job title as written),
  location_text: string | null (city, state or 'Remote' — null if not found),
  mode: 'remote' | 'hybrid' | 'onsite' | null,
  salary_min: number | null (annual base, numbers only — null if not explicitly stated),
  salary_max: number | null (annual base, numbers only — null if not explicitly stated),
  salary_currency: string (default 'USD'),
  salary_type: 'base' | 'ote' | 'base+ote' | null,
  equity_text: string | null (e.g. '0.1% equity' or '$50k RSUs' — null if not mentioned),
  jd_summary_company: string (2-3 sentences about the company and team from the posting),
  jd_summary_role: string (2-3 sentences about the role expectations, requirements and day-to-day),
  raw_title: string (job title exactly as it appears)
}

CRITICAL RULES:
- NEVER guess salary. If salary is not explicitly written in the posting, set salary_min and salary_max to null.
- NEVER invent or assume any information not present in the text.
- The company field must be the actual employer, not the job board (not 'LinkedIn', not 'Indeed', not 'Greenhouse', not 'careers').
- If you cannot determine a field with certainty, set it to null.`

export async function parseJobFromUrl(url) {
  if (!url) throw new Error('Please provide a job posting URL.')

  let data
  try {
    data = await callProxy({
      systemPrompt: SYSTEM_PROMPT,
      fetchUrl: url,
      model: MODELS.fast,
      max_tokens: 2000,
    })
  } catch {
    // The page-fetch (Firecrawl) failed or returned nothing. Don't surface a
    // raw/generic error — give an actionable message and let AddJobModal fall
    // through to manual entry.
    throw new Error(fetchFailureMessage(url))
  }

  const text = data?.content?.[0]?.text
  if (typeof text !== 'string') {
    throw new Error('AI did not return any content.')
  }

  let parsed
  try {
    parsed = extractJson(text)
  } catch {
    throw new Error('AI returned an unparseable response. Please try again.')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI returned an unexpected response shape.')
  }

  // The edge function uses Firecrawl as a fallback for JS-rendered pages,
  // so an empty result here means the URL itself was bad or behind auth.
  const hasCompany = parsed.company && String(parsed.company).trim().length > 0
  const hasRole = parsed.role_title && String(parsed.role_title).trim().length > 0
  if (!hasCompany && !hasRole) {
    throw new Error(
      'Could not extract anything from that page. It may be behind a login, ' +
      'expired, or not actually a job posting — fill in the details manually.'
    )
  }

  parsed.jd_url = url
  // If a salary range was found but the type wasn't explicitly called out,
  // assume "base" — that's the overwhelming default for posted ranges, and
  // making the user resolve a blank field on every parse is friction.
  if ((parsed.salary_min != null || parsed.salary_max != null) && !parsed.salary_type) {
    parsed.salary_type = 'base'
  }
  parsed._usage = {
    inputTokens: data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.output_tokens || 0,
    model: MODELS.fast,
  }
  return parsed
}
