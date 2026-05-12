/**
 * @file Parses an uploaded resume PDF into clean editable markdown.
 *
 * Pipeline:
 *   1. Caller uploads a PDF to the `resumes` storage bucket
 *   2. We download it and base64-encode the bytes
 *   3. The Edge Function forwards both the bytes and our extraction prompt
 *      to Claude, which understands PDFs natively (no client-side PDF lib).
 *   4. Claude returns markdown formatted for our resume editor.
 *
 * Gated by the `resume_imports` tier limit — caller must guard before
 * invoking this agent.
 *
 * @module lib/agents/resumeImporter
 */
import { MODELS, callProxy } from '../ai'
import { downloadResumeFileBase64 } from '../api'

const SYSTEM_PROMPT = `You are a resume parser. You receive a PDF of someone's resume and your job is to convert it into clean, editable Markdown that preserves the structure and content faithfully.

Output a single Markdown document with this exact section pattern:

# {Full Name}
{Title} · {City, State}
{email} · {phone} · {LinkedIn handle or URL if present}

## Summary
{2-4 sentence professional summary, only if one exists in the resume — otherwise skip the heading}

## Experience
**{Company} · {Role}** · {Start} – {End}
- {Bullet 1 verbatim — preserve metrics and proper nouns}
- {Bullet 2}
... (repeat per role, most recent first)

## Education
**{Degree}** · {School} · {Year}

## Skills
{Comma-separated list of skills as written}

## Projects
(only if the resume has them)
**{Project}** — {one-line description}

## Certifications
(only if present)

Rules:
- Do NOT invent any information. If a field isn't present, omit it.
- Preserve bullet points exactly as written — don't rephrase, don't shorten, don't add metrics.
- Use **bold** for company/role/degree titles only. No other bold.
- Return ONLY the markdown — no preamble, no code fences, no commentary.`

/**
 * Parse a resume PDF stored at `filePath` (under the `resumes` bucket)
 * into markdown. Uses Claude Sonnet for higher fidelity on complex layouts.
 *
 * @param {string} filePath - storage path returned by uploadResumeFile()
 * @returns {Promise<{ markdown: string, _usage: object }>}
 */
export async function parseResumeFromFile(filePath) {
  if (!filePath) throw new Error('No file path provided')

  let pdfBase64
  try {
    pdfBase64 = await downloadResumeFileBase64(filePath)
  } catch (err) {
    throw new Error(`Could not read the uploaded file: ${err.message}`)
  }
  if (!pdfBase64) throw new Error('Uploaded file appears to be empty.')

  let data
  try {
    data = await callProxy({
      systemPrompt: SYSTEM_PROMPT,
      pdfBase64,
      pdfMime: 'application/pdf',
      userMessage: 'Convert this resume to the markdown format described in the system prompt.',
      model: MODELS.smart,
      max_tokens: 4000,
    })
  } catch (err) {
    throw new Error(err.message || 'Could not parse the resume.')
  }

  const text = data?.content?.[0]?.text
  if (typeof text !== 'string' || text.trim().length < 40) {
    throw new Error('AI returned an empty response. The PDF may be scanned or unreadable.')
  }

  return {
    markdown: text.trim(),
    _usage: {
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0,
      model: MODELS.smart,
    },
  }
}
