/**
 * @file Interview-prep AI helpers.
 *
 *  - `organizeNotes`  — turns messy job notes into a clean, organized summary.
 *  - `askPrep`        — answers a question using everything known about a job
 *                       (JD, notes, organized summary, Q&A, emails).
 *
 * Both go through the shared Supabase `claude-proxy` edge function and report
 * token usage so the caller can record it against the user's tier quota.
 *
 * @module lib/agents/prep
 */
import { MODELS, callProxy } from '../ai'

const ORGANIZE_SYSTEM = `You organize a job seeker's raw interview notes into a clean, skimmable brief. You are given unstructured notes about a specific job/company (and possibly the job description). Return clean PLAIN TEXT (no markdown symbols like #, *, or backticks). Use short sections with an UPPERCASE header line, then "- " bullet lines under each. Only include sections you actually have content for. Good sections to consider: COMPANY, ROLE & TEAM, COMPENSATION & BENEFITS, PROCESS & TIMELINE, PEOPLE, OPEN QUESTIONS, OTHER. Be concise and faithful — NEVER invent facts that aren't in the notes. Return ONLY the brief, no preamble.`

/**
 * Organize raw job notes into a structured Markdown summary.
 * @param {string} notesText  raw notes (plain text)
 * @param {string} [jdText]   optional job-description text for extra context
 * @returns {Promise<{ summary: string, _usage: object }>}
 */
export async function organizeNotes(notesText, jdText = '') {
  const notes = String(notesText || '').trim()
  if (!notes) throw new Error('Add some notes first, then organize them.')

  const parts = [`NOTES:\n${notes.slice(0, 12000)}`]
  if (jdText) parts.push(`\n\nJOB DESCRIPTION (context):\n${String(jdText).slice(0, 6000)}`)

  const data = await callProxy({
    systemPrompt: ORGANIZE_SYSTEM,
    userMessage: parts.join(''),
    model: MODELS.fast,
    max_tokens: 1200,
  })
  const summary = data?.content?.[0]?.text
  if (typeof summary !== 'string') throw new Error('AI did not return any content.')
  return {
    summary: summary.trim(),
    _usage: {
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0,
      model: MODELS.fast,
    },
  }
}

const ASK_SYSTEM = `You are an interview-prep assistant answering questions about ONE specific job the user is pursuing. Use ONLY the provided context (job details, the user's notes, an organized summary, their interview questions & recorded answers, and related emails). Answer directly and concisely. If the answer isn't in the context, say you don't have that detail in the notes for this job — do not guess. Refer to specifics (numbers, names, dates) when they appear.`

/**
 * Build the context block for a single application from everything we know.
 * @param {object} input
 * @param {object} input.app        application row (with company joined)
 * @param {string} [input.notesText] plain-text notes
 * @param {Array}  [input.questions] application_questions rows
 * @param {Array}  [input.emails]    emails for the app
 * @returns {string}
 */
export function buildJobContext({ app, notesText = '', questions = [], emails = [] }) {
  const lines = []
  const co = app?.company?.name || '—'
  lines.push(`JOB: ${app?.role_title || 'Untitled role'} at ${co}`)
  if (app?.location_text) lines.push(`Location: ${app.location_text}`)
  if (app?.mode) lines.push(`Workplace: ${app.mode}`)
  const sal = [app?.salary_min, app?.salary_max].filter(v => v != null)
  if (sal.length) lines.push(`Base salary: ${sal.join('–')} ${app?.salary_currency || ''}`.trim())
  if (app?.equity_text) lines.push(`Equity: ${app.equity_text}`)
  if (app?.stage) lines.push(`Stage: ${app.stage}`)

  if (app?.jd_text) lines.push(`\nJOB DESCRIPTION / SUMMARY:\n${String(app.jd_text).slice(0, 6000)}`)
  if (app?.prep_summary) lines.push(`\nORGANIZED PREP SUMMARY:\n${String(app.prep_summary).slice(0, 6000)}`)
  if (notesText) lines.push(`\nRAW NOTES:\n${String(notesText).slice(0, 8000)}`)

  const answered = questions.filter(q => q.response)
  if (questions.length) {
    lines.push('\nINTERVIEW QUESTIONS & ANSWERS:')
    questions.forEach(q => {
      lines.push(`Q: ${q.text}`)
      if (q.response) lines.push(`A: ${q.response}`)
    })
  }
  void answered

  if (emails.length) {
    lines.push('\nRELATED EMAILS:')
    emails.slice(0, 12).forEach(e => {
      const who = e.mailbox_source === 'outbound'
        ? `You → ${(e.to_addresses && e.to_addresses[0]) || ''}`
        : (e.from_name || e.from_email || '')
      lines.push(`- [${who}] ${e.subject || '(no subject)'}: ${(e.snippet || e.body_text || '').slice(0, 300)}`)
    })
  }
  return lines.join('\n')
}

/**
 * Ask a question about a job, grounded in its full context.
 * @param {string} question
 * @param {string} context  output of buildJobContext()
 * @param {Array}  [history] prior [{role, content}] turns for follow-ups
 * @returns {Promise<{ answer: string, _usage: object }>}
 */
export async function askPrep(question, context, history = []) {
  const q = String(question || '').trim()
  if (!q) throw new Error('Ask a question.')

  const messages = [
    { role: 'user', content: `Here is everything I know about this job:\n\n${context}` },
    { role: 'assistant', content: 'Got it — ask me anything about this job and I\'ll answer from these details.' },
    ...history,
    { role: 'user', content: q },
  ]

  const data = await callProxy({
    systemPrompt: ASK_SYSTEM,
    messages,
    model: MODELS.fast,
    max_tokens: 800,
  })
  const answer = data?.content?.[0]?.text
  if (typeof answer !== 'string') throw new Error('AI did not return any content.')
  return {
    answer: answer.trim(),
    _usage: {
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0,
      model: MODELS.fast,
    },
  }
}
