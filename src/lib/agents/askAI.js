/**
 * @file Conversational "Ask AI" assistant with multi-turn history.
 *
 * Powers the Ask AI tab in the CmdK sidebar. Calls the `claude-proxy` Edge
 * Function (the Anthropic key never touches the browser); the proxy accepts a
 * `messages` array so the full conversation history is passed through.
 *
 *  - `fetchAskContext()` — cheap snapshot of the user's job search (counts +
 *    a few recent items) rendered as a compact summary string.
 *  - `askQuestion()`     — answers a question grounded in that summary.
 *
 * @module lib/agents/askAI
 */
import { MODELS, callProxy } from '../ai'
import { supabase } from '../supabase'
import { getDashboardSummary, listCalendar, listNudges } from '../api'
import { STAGE_LABEL } from '../stages'
import { shortDate } from '../time'

const SYSTEM_PROMPT = `You are an AI assistant inside a job search management app. You help job seekers understand and manage their active job search.

You have access to the user's current job search data (provided below). Answer their questions accurately based on this data.

Rules:
- Only reference data that is actually provided — never invent applications, companies, emails, or events
- If you don't have enough data to answer, say so honestly
- For data questions ("how many", "which", "when"), give exact numbers from the provided data
- Keep answers concise: 2-4 sentences for simple questions, more detail only if needed
- You can also give general advice about job searching, interviewing, salary negotiation, networking, etc.
- Be encouraging but honest — don't sugarcoat bad situations
- Use a friendly, supportive tone — like a smart friend who knows your job search inside and out
- Format with bullet points or bold when it helps readability

Current job search data:
`

/**
 * Build a compact, AI-readable snapshot of the user's job search. Uses counts
 * and small LIMITed fetches — never the full record sets. RLS scopes every
 * query to the signed-in user.
 * @returns {Promise<string>} summary string for the system prompt
 */
export async function fetchAskContext() {
  const now = new Date()
  const weekAhead = new Date(now.getTime() + 7 * 24 * 3600 * 1000)

  const [summary, events, nudges, tasksRes, emailsRes] = await Promise.all([
    getDashboardSummary().catch(() => ({ total: 0, byStage: {} })),
    listCalendar({ from: now.toISOString(), to: weekAhead.toISOString() }).catch(() => []),
    listNudges().catch(() => []),
    supabase.from('tasks')
      .select('title, due_at')
      .eq('done', false)
      .gte('due_at', now.toISOString())
      .lte('due_at', weekAhead.toISOString())
      .order('due_at', { ascending: true })
      .limit(10),
    supabase.from('emails')
      .select('subject, from_name, from_email, received_at')
      .eq('is_unread', true)
      .order('received_at', { ascending: false })
      .limit(5),
  ])

  const tasks = tasksRes?.data || []
  const emails = emailsRes?.data || []
  const lines = []

  // Applications by stage (only non-zero buckets).
  const byStage = summary?.byStage || {}
  const stageLines = Object.entries(byStage)
    .filter(([, n]) => n > 0)
    .map(([stage, n]) => `- ${STAGE_LABEL[stage] || stage}: ${n}`)
  lines.push(`APPLICATIONS (active total: ${summary?.total || 0})`)
  lines.push(stageLines.length ? stageLines.join('\n') : '- none')

  lines.push(`\nTASKS DUE THIS WEEK (${tasks.length})`)
  lines.push(tasks.length
    ? tasks.map(t => `- ${t.title}${t.due_at ? ` (due ${shortDate(t.due_at)})` : ''}`).join('\n')
    : '- none')

  lines.push(`\nUPCOMING EVENTS — next 7 days (${events.length})`)
  lines.push(events.length
    ? events.map(e => {
        const co = e.application?.company?.name
        return `- ${e.title || 'Event'}${e.starts_at ? ` on ${shortDate(e.starts_at)}` : ''}${co ? ` (${co})` : ''}`
      }).join('\n')
    : '- none')

  lines.push(`\nRECENT UNREAD EMAILS (${emails.length})`)
  lines.push(emails.length
    ? emails.map(e => `- "${e.subject || '(no subject)'}" from ${e.from_name || e.from_email || 'unknown'}`).join('\n')
    : '- none')

  lines.push(`\nACTIVE NUDGES (${nudges.length})`)
  lines.push(nudges.length
    ? nudges.map(n => `- ${n.body_md || n.kind}`).join('\n')
    : '- none')

  return lines.join('\n')
}

askQuestion.lastUsage = null

/**
 * Ask a question grounded in the user's job search context.
 * @param {string} question
 * @param {string} contextSummary  output of fetchAskContext()
 * @param {Array}  [conversationHistory] prior [{role, content}] turns
 * @returns {Promise<{ answer: string, _usage: object }>}
 */
export async function askQuestion(question, contextSummary = '', conversationHistory = []) {
  if (!question || !question.trim()) throw new Error('Please provide a question.')

  const messages = [
    ...conversationHistory,
    { role: 'user', content: question.trim() },
  ]

  let data
  try {
    data = await callProxy({
      systemPrompt: SYSTEM_PROMPT + (contextSummary || '(no data available)'),
      messages,
      model: MODELS.smart,
      max_tokens: 1200,
    })
  } catch (err) {
    throw new Error(`Ask AI failed: ${err.message}`, { cause: err })
  }

  askQuestion.lastUsage = {
    inputTokens: data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.output_tokens || 0,
    model: MODELS.smart,
  }

  const text = data?.content?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Ask AI response did not include text content.')
  }
  return { answer: text.trim(), _usage: askQuestion.lastUsage }
}
