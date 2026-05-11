/**
 * @file Scores a resume against a job description for ATS matching.
 *
 * Returns { score, missing_keywords, suggestions[] } where each
 * suggestion includes a concrete rewritten bullet incorporating the
 * keyword naturally.
 *
 * @module lib/agents/atsScorer
 */
import { callClaude, MODELS, extractJson } from '../ai'

const SYSTEM_PROMPT = `You are an ATS (Applicant Tracking System) expert. Score how well a resume matches a job description. Return ONLY a valid JSON object with NO markdown, no backticks, no explanation.

Required fields:
{
  score: number (0-100, how well the resume matches the JD for ATS purposes),
  missing_keywords: string[] (important keywords/skills in the JD not found in the resume — max 15),
  suggestions: [{ keyword: string, rewrite: string (a specific resume bullet suggestion that incorporates this keyword naturally) }] (max 8 suggestions)
}

Be specific and actionable. Rewrite suggestions should sound like real resume bullets, not generic advice.`

export async function scoreResume(resumeContent, jdText) {
  if (!resumeContent || !resumeContent.trim()) throw new Error('Resume content is empty.')
  if (!jdText || !jdText.trim()) throw new Error('Job description text is empty.')

  const userMessage =
    `RESUME:\n${resumeContent.slice(0, 6000)}\n\n---\n\nJOB DESCRIPTION:\n${jdText.slice(0, 6000)}`

  let raw
  try {
    raw = await callClaude(SYSTEM_PROMPT, userMessage, MODELS.fast)
  } catch (err) {
    throw new Error(`ATS scoring failed: ${err.message}`)
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
