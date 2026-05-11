/**
 * @file Generates an interview prep guide for a specific application + stage.
 *
 * Takes the application record + resume markdown + the current interview
 * step title, and returns a structured prep guide (overview, likely
 * questions with rationale and tips, company intel, prep tips, red flags,
 * questions to ask back).
 *
 * @module lib/agents/interviewPrep
 */
import { callClaude, MODELS, extractJson } from '../ai'

const SYSTEM_PROMPT = `You are an expert interview coach with deep knowledge of hiring processes across industries. Generate a comprehensive interview prep guide for a specific interview stage.

Return ONLY a valid JSON object with NO markdown, no backticks, no explanation:
{
  overview: string (2-3 sentences about what to expect at this specific stage),
  likely_questions: [{ question: string, why_asked: string, strong_answer_tips: string }] (8-12 questions),
  company_intel: string (what the company seems to value based on the JD and public knowledge),
  preparation_tips: string[] (5-7 specific, actionable tips for this stage),
  red_flags_to_watch: string[] (2-3 things to be cautious about),
  questions_to_ask_them: string[] (4-5 strong questions the candidate should ask)
}

Be specific to the role, company, and interview stage. Generic advice is not helpful.`

export async function generatePrepGuide(application, resumeContent, currentStep) {
  if (!application) throw new Error('Application is required.')
  if (!currentStep) throw new Error('Current interview step is required.')

  const companyName = application.company?.name || application.company_name || 'the company'
  const userMessage =
    `INTERVIEW STAGE: ${currentStep}\n` +
    `APPLICATION STAGE: ${application.stage || 'unknown'}\n\n` +
    `ROLE: ${application.role_title || '(role unknown)'}\n` +
    `COMPANY: ${companyName}\n` +
    `LOCATION: ${application.location_text || 'not specified'}\n` +
    `MODE: ${application.mode || 'not specified'}\n\n` +
    `COMPANY SUMMARY (from JD):\n${application.jd_summary_company || '(none captured)'}\n\n` +
    `ROLE SUMMARY (from JD):\n${application.jd_summary_role || '(none captured)'}\n\n` +
    `CANDIDATE RESUME:\n${(resumeContent || '(no resume attached)').slice(0, 6000)}`

  let raw
  try {
    raw = await callClaude(SYSTEM_PROMPT, userMessage, MODELS.smart)
  } catch (err) {
    throw new Error(`Interview prep generation failed: ${err.message}`)
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
