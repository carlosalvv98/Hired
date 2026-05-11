/**
 * @file Tailors a resume to a specific JD without fabricating experience.
 *
 * Uses MODELS.smart (Sonnet) since this is a higher-stakes, longer-form
 * generation. Returns { tailored_content, changes_made[], keywords_added[] }.
 *
 * @module lib/agents/resumeTailor
 */
import { callClaude, MODELS, extractJson } from '../ai'

const SYSTEM_PROMPT = `You are an expert resume writer and career coach. Tailor a resume to better match a specific job description while keeping it authentic and truthful. Never fabricate experience or skills.

Return ONLY a valid JSON object with NO markdown, no backticks, no explanation:
{
  tailored_content: string (the full tailored resume in the same markdown format as the input),
  changes_made: string[] (list of specific changes made, e.g. 'Reordered skills to lead with Python and SQL'),
  keywords_added: string[] (keywords from the JD naturally incorporated into the resume)
}

CRITICAL: Only enhance and reframe existing experience. Never add experience, skills, or achievements that are not in the original resume.`

export async function tailorResume(resumeContent, jdText, atsMissingKeywords = []) {
  if (!resumeContent || !resumeContent.trim()) throw new Error('Resume content is empty.')
  if (!jdText || !jdText.trim()) throw new Error('Job description text is empty.')

  const missingBlock = atsMissingKeywords && atsMissingKeywords.length
    ? `\n\n---\n\nKEYWORDS THE ATS SCORER FLAGGED AS MISSING (try to weave naturally where truthful):\n${atsMissingKeywords.join(', ')}`
    : ''

  const userMessage =
    `ORIGINAL RESUME:\n${resumeContent}\n\n---\n\nTARGET JOB DESCRIPTION:\n${jdText.slice(0, 6000)}${missingBlock}`

  let raw
  try {
    raw = await callClaude(SYSTEM_PROMPT, userMessage, MODELS.smart)
  } catch (err) {
    throw new Error(`Resume tailoring failed: ${err.message}`)
  }

  let parsed
  try {
    parsed = extractJson(raw)
  } catch {
    throw new Error('AI returned an unparseable response. Please try again.')
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.tailored_content !== 'string') {
    throw new Error('AI returned an unexpected response shape.')
  }
  parsed._usage = callClaude.lastUsage || null
  return parsed
}
