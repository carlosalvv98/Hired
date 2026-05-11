/**
 * @file Conversational "Ask AI" assistant with multi-turn history.
 *
 * Calls the `claude-proxy` Edge Function so the Anthropic API key never
 * touches the browser. The proxy accepts a `messages` array, so we pass
 * the full conversation history through it.
 *
 * @module lib/agents/askAI
 */
import { MODELS, callProxy, extractJson } from '../ai'

const SYSTEM_PROMPT = `You are Hired AI, a smart job search assistant built into the Hired app. You have access to the user's job search data and can answer questions about it and take actions.

You can answer questions like:
- 'Which companies haven't replied in 2 weeks?'
- 'How many applications do I have in the interview stage?'
- 'What should I follow up on today?'

You can also suggest actions by including them in your response JSON.

Return ONLY a valid JSON object:
{
  answer: string (your response in plain conversational language, can use markdown),
  actions: [{ type: 'create_task' | 'archive_application' | 'open_application', payload: object }] | null
}

Be conversational, specific, and helpful. Reference actual company names and data from their search. Keep answers concise.`

askQuestion.lastUsage = null

export async function askQuestion(question, userContext, conversationHistory = []) {
  if (!question || !question.trim()) throw new Error('Please provide a question.')

  // Inline fresh user context as a prefix to the new question so the model
  // sees current data every turn without bloating system. Older turns
  // already carry the context they were given at the time.
  const ctxSummary = userContext
    ? `Here is the user's current job search context as JSON:\n\n${JSON.stringify({
        applications: (userContext.applications || []).slice(0, 50),
        stageCounts: userContext.stageCounts || {},
        recentEmails: (userContext.recentEmails || []).slice(0, 10),
        tasks: (userContext.tasks || []).slice(0, 20),
      }, null, 2)}\n\n---\n\n`
    : ''

  const messages = [
    ...conversationHistory,
    { role: 'user', content: `${ctxSummary}USER QUESTION:\n${question}` },
  ]

  let data
  try {
    data = await callProxy({
      systemPrompt: SYSTEM_PROMPT,
      messages,
      model: MODELS.smart,
      max_tokens: 2000,
    })
  } catch (err) {
    throw new Error(`Ask AI failed: ${err.message}`)
  }

  askQuestion.lastUsage = {
    inputTokens: data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.output_tokens || 0,
    model: MODELS.smart,
  }

  const text = data?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error('Ask AI response did not include text content.')

  let parsed
  try {
    parsed = extractJson(text)
  } catch {
    return { answer: text, actions: null, _usage: askQuestion.lastUsage }
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.answer !== 'string') {
    return { answer: text, actions: null, _usage: askQuestion.lastUsage }
  }
  parsed._usage = askQuestion.lastUsage
  return parsed
}
