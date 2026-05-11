/**
 * @file Generates a small set of specific, actionable nudges for the dashboard.
 *
 * Takes the user's current pipeline context (apps, tasks, upcoming events,
 * email count) and returns an array of nudge objects matching the
 * `ai_nudges` schema (kind, body_md, cta_label, application_id).
 *
 * @module lib/agents/nudgeGenerator
 */
import { callClaude, MODELS, extractJson } from '../ai'

const SYSTEM_PROMPT = `You are a proactive job search coach. Analyze a user's job search data and generate helpful, specific nudges to keep their search on track.

Return ONLY a valid JSON array (not an object, an ARRAY) with NO markdown, no backticks, no explanation. Maximum 5 nudges:
[{
  kind: 'follow_up' | 'stale_app' | 'prep_reminder' | 'offer_deadline' | 'salary_insight' | 'pace_check',
  body_md: string (1-2 sentences, specific and actionable, mention company/role names),
  cta_label: string (short action label, max 4 words),
  application_id: string | null (the relevant application id if applicable)
}]

Be specific — mention actual company names and roles. Do not generate generic advice.`

export async function generateNudges(userContext) {
  if (!userContext) throw new Error('userContext is required.')

  const ctx = {
    applications: (userContext.applications || []).slice(0, 30),
    tasks: (userContext.tasks || []).slice(0, 15),
    upcomingEvents: (userContext.upcomingEvents || []).slice(0, 10),
    emailCount: userContext.emailCount ?? 0,
  }

  // Send as JSON — the model reads JSON inputs fine and it keeps the
  // prompt token-efficient.
  const userMessage = `Here is the user's current job search context as JSON. Produce up to 5 specific nudges.

${JSON.stringify(ctx, null, 2)}`

  let raw
  try {
    raw = await callClaude(SYSTEM_PROMPT, userMessage, MODELS.fast)
  } catch (err) {
    throw new Error(`Nudge generation failed: ${err.message}`)
  }

  let parsed
  try {
    parsed = extractJson(raw)
  } catch {
    throw new Error('AI returned an unparseable response. Please try again.')
  }
  if (!Array.isArray(parsed)) {
    // Be forgiving: some models wrap arrays in { nudges: [...] }
    if (parsed && Array.isArray(parsed.nudges)) {
      return parsed.nudges
    }
    throw new Error('AI returned an unexpected response shape (expected an array).')
  }
  return parsed
}
