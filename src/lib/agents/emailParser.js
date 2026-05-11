/**
 * @file Extracts structured fields from a job-related email.
 *
 * Returns a JSON object with stage_signal, contact, interview slots,
 * amounts, sentiment, action items, and a confidence score. Callers
 * should treat confidence < 0.85 as needs-review.
 *
 * @module lib/agents/emailParser
 */
import { callClaude, MODELS, extractJson } from '../ai'

const SYSTEM_PROMPT = `You are an email parser for a job application tracker. A user has received a job-related email and you must extract all relevant information. Return ONLY a valid JSON object with NO markdown, no backticks, no explanation.

Required fields:
{
  company: string | null,
  stage_signal: 'applied' | 'screen' | 'iv' | 'final' | 'offer' | 'reject' | 'ghost' | null,
  contact: { name: string | null, email: string | null, role: string | null } | null,
  interview_slots: [{ starts_at: string (ISO 8601), duration_min: number, label: string }] | null,
  amounts: { base: number | null, ote: number | null, equity_text: string | null, currency: string } | null,
  sentiment: 'positive' | 'neutral' | 'negative',
  next_steps: string[] | null,
  action_items: string[] | null,
  thread_summary: string (1-2 sentences summarizing what this email is about),
  confidence: number (0.0 to 1.0 — how confident you are in the stage_signal extraction)
}

CRITICAL RULES:
- NEVER guess or invent information not present in the email.
- Only set stage_signal if the email clearly signals a stage change.
- Set confidence below 0.85 if you are uncertain about the stage signal.
- action_items should be concrete things the recipient needs to do (e.g. 'Reply with availability', 'Complete coding assessment by Friday').`

export async function parseEmail(emailText) {
  if (!emailText || !emailText.trim()) {
    throw new Error('No email content to parse.')
  }

  let raw
  try {
    raw = await callClaude(SYSTEM_PROMPT, emailText, MODELS.fast)
  } catch (err) {
    throw new Error(`Email parsing failed: ${err.message}`)
  }

  let parsed
  try {
    parsed = extractJson(raw)
  } catch {
    throw new Error('AI returned an unparseable response. Please try again.')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI returned an unexpected response shape.')
  }
  parsed._usage = callClaude.lastUsage || null
  return parsed
}
