/**
 * @file Parses an uploaded resume PDF into structured editor blocks.
 *
 * Pipeline:
 *   1. Caller uploads a PDF to the `resumes` storage bucket.
 *   2. We download it and base64-encode the bytes.
 *   3. The Edge Function forwards both the bytes and our extraction
 *      prompt to Claude. Claude understands PDFs natively (no client-
 *      side PDF lib).
 *   4. Claude returns a strict JSON object that we convert into the
 *      modular block schema the editor renders.
 *
 * Gated by the `resume_imports` tier limit — caller must guard before
 * invoking this agent.
 *
 * @module lib/agents/resumeImporter
 */
import { MODELS, callProxy, extractJson } from '../ai'
import { downloadResumeFileBase64 } from '../api'
import { uid } from '../resumeBlocks'

const SYSTEM_PROMPT = `You are a resume parser. You receive a PDF of someone's resume and your job is to extract the contents into a structured JSON document the application will render into editable blocks.

Return ONLY a JSON object — no preamble, no code fences, no commentary.

Schema:
{
  "header": {
    "name": "string",
    "title": "string (one-line professional title; empty if not present)",
    "location": "string (city, state; empty if not present)",
    "email": "string (empty if not present)",
    "phone": "string (empty if not present)",
    "links": [{ "label": "string", "url": "https://…" }]
  },
  "summary": "string (the professional summary as written; empty string if none)",
  "experience": [
    {
      "company": "string",
      "role": "string",
      "location": "string",
      "start": "string (e.g. 'Jun 2024' — preserve the format used in the resume)",
      "end": "string (e.g. 'Present' or 'Aug 2025')",
      "bullets": ["string (one bullet per array item, verbatim, no leading dash)"]
    }
  ],
  "education": [
    {
      "degree": "string",
      "school": "string",
      "location": "string",
      "start": "string",
      "end": "string",
      "gpa": "string (empty if not present)",
      "bullets": ["string"]
    }
  ],
  "skills": "string (comma-separated list as written, preserving any category groupings on separate lines)",
  "projects": [
    {
      "name": "string",
      "link": "string (url, or empty)",
      "start": "string",
      "end": "string",
      "bullets": ["string"]
    }
  ],
  "certifications": "string (one per line, as written; empty if none)"
}

Rules:
- Do NOT invent any information. If a field isn't present, use an empty string or empty array.
- Preserve bullet text exactly — do not rephrase, shorten, or add metrics.
- For dates, use the exact text from the resume (don't normalize "2024" to "January 2024").
- Bullets must be plain text only — do not include markdown asterisks, dashes, or HTML.
- If a section doesn't exist in the resume, omit it from the JSON (or use empty value).`

function htmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function bulletsToHtml(arr) {
  if (!Array.isArray(arr)) return []
  return arr
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .map(text => ({ id: uid('p'), html: htmlEscape(text) }))
}

// Convert the strict JSON Claude returned into the block array the
// editor expects. Each top-level field becomes one or more blocks.
function jsonToBlocks(parsed) {
  const blocks = []

  // Header (always include, even if mostly empty — gives the user a
  // starting point so the editor isn't blank).
  const h = parsed.header || {}
  blocks.push({
    id: uid(), type: 'header', included: true,
    data: {
      name: h.name || '',
      title: h.title || '',
      location: h.location || '',
      email: h.email || '',
      phone: h.phone || '',
      links: Array.isArray(h.links)
        ? h.links.filter(l => l && (l.url || l.label)).map(l => ({ label: l.label || l.url, url: l.url || l.label }))
        : [],
    },
  })

  if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
    blocks.push({
      id: uid(), type: 'summary', included: true,
      data: { html: htmlEscape(parsed.summary.trim()) },
    })
  }

  if (Array.isArray(parsed.experience)) {
    for (const e of parsed.experience) {
      if (!e) continue
      blocks.push({
        id: uid(), type: 'experience', included: true,
        data: {
          company: e.company || '',
          role: e.role || '',
          location: e.location || '',
          start: e.start || '',
          end: e.end || '',
          bullets: bulletsToHtml(e.bullets),
        },
      })
    }
  }

  if (Array.isArray(parsed.education)) {
    for (const e of parsed.education) {
      if (!e) continue
      blocks.push({
        id: uid(), type: 'education', included: true,
        data: {
          degree: e.degree || '',
          school: e.school || '',
          location: e.location || '',
          start: e.start || '',
          end: e.end || '',
          gpa: e.gpa || '',
          bullets: bulletsToHtml(e.bullets),
        },
      })
    }
  }

  if (typeof parsed.skills === 'string' && parsed.skills.trim()) {
    // Preserve line breaks the user had (e.g. "Languages: …\nFrameworks: …").
    const html = parsed.skills.split('\n').map(line => htmlEscape(line.trim())).filter(Boolean).join('<br>')
    blocks.push({
      id: uid(), type: 'skills', included: true,
      data: { html },
    })
  }

  if (Array.isArray(parsed.projects)) {
    for (const p of parsed.projects) {
      if (!p) continue
      blocks.push({
        id: uid(), type: 'projects', included: true,
        data: {
          name: p.name || '',
          link: p.link || '',
          start: p.start || '',
          end: p.end || '',
          bullets: bulletsToHtml(p.bullets),
        },
      })
    }
  }

  if (typeof parsed.certifications === 'string' && parsed.certifications.trim()) {
    const html = parsed.certifications.split('\n').map(line => htmlEscape(line.trim())).filter(Boolean).join('<br>')
    blocks.push({
      id: uid(), type: 'certifications', included: true,
      data: { html },
    })
  }

  return blocks
}

/**
 * Parse a resume PDF stored at `filePath` (under the `resumes` bucket)
 * into the modular block schema. Uses Claude Sonnet for higher fidelity
 * on complex layouts.
 *
 * @param {string} filePath - storage path returned by uploadResumeFile()
 * @returns {Promise<{ blocks: Array, name: string, _usage: object }>}
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
      userMessage: 'Parse this resume into the JSON schema described in the system prompt. Return only the JSON object.',
      model: MODELS.smart,
      max_tokens: 4000,
    })
  } catch (err) {
    throw new Error(err.message || 'Could not parse the resume.')
  }

  const text = data?.content?.[0]?.text
  if (typeof text !== 'string' || text.trim().length < 10) {
    throw new Error('AI returned an empty response. The PDF may be scanned or unreadable.')
  }

  let parsed
  try {
    parsed = extractJson(text)
  } catch (err) {
    throw new Error('Could not understand the AI response. The PDF may be unusual — try a cleaner export.')
  }

  const blocks = jsonToBlocks(parsed)
  if (blocks.length <= 1 && !blocks[0]?.data?.name) {
    throw new Error('Could not extract any content. The PDF may be scanned or image-based.')
  }

  // Derive a default resume name from the parsed header — caller can
  // override but this gives "Carlos Alvarez — Product Manager" out of
  // the box rather than "Untitled resume".
  const headerData = blocks[0]?.data || {}
  const nameParts = [headerData.name, headerData.title].filter(Boolean)
  const derivedName = nameParts.join(' — ') || 'Imported resume'

  return {
    blocks,
    name: derivedName,
    _usage: {
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0,
      model: MODELS.smart,
    },
  }
}
