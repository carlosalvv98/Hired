/**
 * @file Writing-style learner (E4).
 *
 * Analyzes a user's SENT emails to extract how they naturally write, so the
 * reply/draft generators can produce email in the user's own voice. Only the
 * extracted *patterns* are returned/stored — never the raw email text.
 *
 * Uses Sonnet (quality-sensitive, expensive) and is therefore quota-gated by
 * the caller via the `style_analysis` tier limit.
 *
 * @module lib/agents/styleAnalyzer
 */
import { MODELS, callProxy, extractJson } from '../ai'
import { supabase } from '../supabase'

// Minimum sent emails before a reliable profile can be built. Analyzing 1–2
// emails produces noise, not a voice.
export const MIN_STYLE_EMAILS = 5

const SYSTEM_PROMPT = `You are a writing style analyst. Given a collection of emails written by one person, extract their writing style profile.

Analyze these patterns:
- Formality level (1-5 scale: 1=very casual, 5=very formal)
- Average sentence length tendency (short/medium/long)
- Greeting style (e.g., "Hi [name]", "Hey!", "Hello,", "Good morning,", none)
- Sign-off style (e.g., "Best,", "Thanks!", "Cheers,", "Talk soon,", full signature block)
- Tone (warm/neutral/direct/enthusiastic)
- Use of exclamation marks (never/rarely/sometimes/often)
- Use of emojis (never/rarely/sometimes/often)
- Vocabulary level (simple/moderate/sophisticated)
- Paragraph structure (short punchy paragraphs / longer detailed paragraphs / mixed)
- Typical opening pattern (jumps straight to business / small talk first / references previous conversation)
- Typical closing pattern (clear next steps / open-ended / grateful)
- Any distinctive phrases or patterns you notice

Respond ONLY in JSON, no markdown fences:
{
  "formality": 3,
  "sentence_length": "medium",
  "greeting_style": "Hi [name],",
  "signoff_style": "Best,",
  "tone": "warm",
  "exclamation_marks": "sometimes",
  "emojis": "rarely",
  "vocabulary": "moderate",
  "paragraph_style": "short",
  "opening_pattern": "references previous conversation",
  "closing_pattern": "clear next steps",
  "distinctive_patterns": ["uses 'just wanted to' often", "asks one question per email"],
  "summary": "Warm and professional. Keeps emails concise with short paragraphs. Opens with context, closes with a clear ask. Friendly but not overly casual."
}`

/**
 * Count the user's analyzable sent emails (have a body to learn from).
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function countSentEmails(userId) {
  const { count, error } = await supabase
    .from('emails')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('folder', 'sent')
    .not('body_text', 'is', null)
  if (error) throw error
  return count || 0
}

/**
 * Analyze the user's recent sent emails into a writing-style profile.
 * Throws a `NOT_ENOUGH`-coded error if there aren't enough emails.
 * @param {string} userId
 * @returns {Promise<{ style: object, sentCount: number, _usage: object }>}
 */
export async function analyzeWritingStyle(userId) {
  const { data, error } = await supabase
    .from('emails')
    .select('body_text, subject')
    .eq('user_id', userId)
    .eq('folder', 'sent')
    .not('body_text', 'is', null)
    .order('received_at', { ascending: false })
    .limit(15)
  if (error) throw error

  const emails = data || []
  if (emails.length < MIN_STYLE_EMAILS) {
    const err = new Error(`Send at least ${MIN_STYLE_EMAILS} emails first so the AI can learn your style`)
    err.code = 'NOT_ENOUGH'
    throw err
  }

  // Concatenate with separators; truncate each body so the context stays small.
  const corpus = emails
    .map((e, i) => `--- Email ${i + 1} ---\nSubject: ${e.subject || '(no subject)'}\n${String(e.body_text || '').slice(0, 500)}`)
    .join('\n\n')

  const resp = await callProxy({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: corpus,
    model: MODELS.smart,
    max_tokens: 1000,
  })
  const text = resp?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error('AI did not return a style profile.')
  const style = extractJson(text)

  return {
    style,
    sentCount: emails.length,
    _usage: {
      inputTokens: resp?.usage?.input_tokens || 0,
      outputTokens: resp?.usage?.output_tokens || 0,
      model: MODELS.smart,
    },
  }
}

/**
 * Format a style profile into a prompt-ready block of labeled fields.
 * @param {object} style
 * @returns {string}
 */
export function buildStyleBlock(style) {
  if (!style) return ''
  const dp = Array.isArray(style.distinctive_patterns)
    ? style.distinctive_patterns.join('; ')
    : (style.distinctive_patterns || 'none noted')
  return [
    `- Formality: ${style.formality}/5`,
    `- Tone: ${style.tone}`,
    `- Sentence length: ${style.sentence_length}`,
    `- Greeting style: "${style.greeting_style}"`,
    `- Sign-off style: "${style.signoff_style}"`,
    `- Exclamation marks: ${style.exclamation_marks}`,
    `- Emojis: ${style.emojis}`,
    `- Vocabulary: ${style.vocabulary}`,
    `- Paragraph style: ${style.paragraph_style}`,
    `- Opening pattern: ${style.opening_pattern}`,
    `- Closing pattern: ${style.closing_pattern}`,
    `- Distinctive patterns: ${dp}`,
    `- Style summary: ${style.summary}`,
  ].join('\n')
}

/**
 * System prompt for generating an inbound REPLY in the user's voice.
 * Job context is supplied in the user message (matches the generic path).
 */
export function buildReplyStyleSystem(style) {
  return `You are an email reply assistant. Generate a reply that matches the user's personal writing style.

The user's writing style profile:
${buildStyleBlock(style)}

Write the reply as if the user wrote it themselves. Match their greeting, sign-off, paragraph length, formality, and any distinctive patterns. The reply should feel natural and authentic to their voice — not a parody of it.

Rules:
- Write a complete, ready-to-send email body.
- Never invent facts about the candidate.
- If the inbound email is a rejection, be gracious regardless.
- Sign off in the user's typical style, with [Your name] as the name placeholder.
- Do NOT wrap in markdown or code fences.
- Respond with ONLY the email body text, nothing else.`
}

/**
 * System prompt for drafting an OUTBOUND email in the user's voice. Includes the
 * purpose definitions since the user message only names the chosen purpose.
 */
export function buildDraftStyleSystem(style) {
  return `You are an email drafting assistant. Write an outbound email that matches the user's personal writing style.

The user's writing style profile:
${buildStyleBlock(style)}

Purpose definitions:
- Thank You: Grateful follow-up after an interview or meeting. Reference something specific (include a [specific detail from your conversation] placeholder). Express genuine enthusiasm for the role.
- Follow Up: Polite check-in on application status. Not pushy. Reaffirm interest.
- Introduction: Cold outreach to someone at the company. Brief, respectful of their time, clear about why you're reaching out.
- Question: Asking about the role, interview process, timeline, or next steps. Direct and specific.

Write the email as if the user wrote it themselves. Match their greeting, sign-off, paragraph style, and voice. Combine the purpose with their natural style.

Rules:
- Generate BOTH a subject line and email body.
- Never invent facts about the candidate or the conversation.
- Sign off in the user's typical style with [Your name].
- Do NOT wrap in markdown or code fences.
- Respond ONLY in JSON: {"subject": "...", "body": "..."}`
}
