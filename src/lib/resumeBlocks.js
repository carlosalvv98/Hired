/**
 * @file Block schema for the modular resume editor.
 *
 * A resume is an ordered array of typed blocks. Each block carries a
 * stable `id`, a `type`, an `included` flag (so users can toggle a
 * section off without losing the content), and a `data` object whose
 * shape depends on type.
 *
 * Persisted as JSONB in `resumes.content_blocks`. Legacy resumes that
 * only have `content_md` are converted on-load by `markdownToBlocks`.
 *
 * @module lib/resumeBlocks
 */

export const BLOCK_TYPES = [
  'header',
  'summary',
  'experience',
  'education',
  'skills',
  'projects',
  'certifications',
  'custom',
]

export const BLOCK_LABELS = {
  header:         'Header',
  summary:        'Summary',
  experience:     'Experience',
  education:      'Education',
  skills:         'Skills',
  projects:       'Projects',
  certifications: 'Certifications',
  custom:         'Custom section',
}

export function uid(prefix = 'b') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

// Default data shape per block type.
function defaultData(type) {
  switch (type) {
    case 'header':         return { name: '', title: '', location: '', email: '', phone: '', links: [] }
    case 'summary':        return { html: '' }
    case 'experience':     return { company: '', role: '', location: '', start: '', end: '', bullets: [{ id: uid('p'), html: '' }] }
    case 'education':      return { degree: '', school: '', location: '', start: '', end: '', gpa: '', bullets: [] }
    case 'skills':         return { html: '' }
    case 'projects':       return { name: '', link: '', start: '', end: '', bullets: [{ id: uid('p'), html: '' }] }
    case 'certifications': return { html: '' }
    case 'custom':         return { title: 'Custom section', html: '' }
    default:               return {}
  }
}

export function emptyBlock(type) {
  return { id: uid(), type, included: true, data: defaultData(type) }
}

export function starterBlocks() {
  return [
    emptyBlock('header'),
    emptyBlock('summary'),
    emptyBlock('experience'),
    emptyBlock('education'),
    emptyBlock('skills'),
  ]
}

// ─── Markdown → HTML (inline) ──────────────────────────────────────────
// Just bold/italic — keeps it tiny. Real link handling can come later.
function inlineMdToHtml(s) {
  if (!s) return ''
  let out = s
  // Escape any literal HTML first so we don't render attacker-controlled tags.
  out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // *italic* (lone asterisks — be conservative: require word chars on at least one side)
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  return out.trim()
}

// ─── Legacy `content_md` → blocks ──────────────────────────────────────
// Best-effort parser for resumes that were imported before the modular
// editor existed. Not perfect — users can tidy up after migration —
// but better than dumping raw markdown into a textarea.
export function markdownToBlocks(md) {
  if (!md || typeof md !== 'string') return starterBlocks()
  const lines = md.split(/\r?\n/)
  const blocks = []

  // 1. Pull the first H1 (# Name) + the next 1-2 lines as the header.
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (lines[i]?.startsWith('# ')) {
    const name = lines[i].replace(/^#\s+/, '').trim()
    const meta = []
    i++
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#')) {
      meta.push(lines[i].trim()); i++
    }
    const flat = meta.join(' · ')
    // Heuristic split: first chunk is title · location, next chunk has email/phone/links.
    const parts = flat.split('·').map(s => s.trim()).filter(Boolean)
    const email = parts.find(p => /@/.test(p)) || ''
    const phone = parts.find(p => /\d{3}/.test(p) && !/@/.test(p) && !/^https?:/i.test(p)) || ''
    const linkParts = parts.filter(p => /^https?:/i.test(p))
    const remaining = parts.filter(p => p !== email && p !== phone && !linkParts.includes(p))
    const title = remaining[0] || ''
    const location = remaining[1] || ''
    blocks.push({
      id: uid(), type: 'header', included: true,
      data: {
        name, title, location, email, phone,
        links: linkParts.map(url => ({ label: url, url })),
      },
    })
  } else {
    blocks.push(emptyBlock('header'))
  }

  // 2. Walk remaining content section by section (## Heading … until next ##).
  let current = null   // { heading, body: [] }
  const sections = []
  for (; i < lines.length; i++) {
    const ln = lines[i]
    if (ln.startsWith('## ')) {
      if (current) sections.push(current)
      current = { heading: ln.replace(/^##\s+/, '').trim(), body: [] }
    } else if (current) {
      current.body.push(ln)
    }
  }
  if (current) sections.push(current)

  for (const sec of sections) {
    const h = sec.heading.toLowerCase()
    const body = sec.body.join('\n').trim()
    if (!body) continue

    if (h.startsWith('summary') || h.startsWith('profile') || h.startsWith('about')) {
      blocks.push({ id: uid(), type: 'summary', included: true, data: { html: inlineMdToHtml(body.replace(/\n+/g, ' ')) } })
    } else if (h.startsWith('experience') || h.startsWith('work')) {
      blocks.push(...parseExperienceSection(sec.body))
    } else if (h.startsWith('education')) {
      blocks.push(...parseEducationSection(sec.body))
    } else if (h.startsWith('skill') || h.startsWith('technical') || h.startsWith('languages')) {
      blocks.push({ id: uid(), type: 'skills', included: true, data: { html: inlineMdToHtml(body.replace(/\n+/g, '<br>')) } })
    } else if (h.startsWith('project')) {
      blocks.push(...parseProjectsSection(sec.body))
    } else if (h.startsWith('cert')) {
      blocks.push({ id: uid(), type: 'certifications', included: true, data: { html: inlineMdToHtml(body.replace(/\n+/g, '<br>')) } })
    } else {
      blocks.push({ id: uid(), type: 'custom', included: true, data: { title: sec.heading, html: inlineMdToHtml(body.replace(/\n+/g, '<br>')) } })
    }
  }

  if (blocks.length <= 1) {
    // Couldn't parse anything beyond a header — give the user starter blocks
    // so they can build from scratch rather than staring at an empty page.
    return [...blocks, emptyBlock('summary'), emptyBlock('experience')]
  }
  return blocks
}

// Parse the body of a `## Experience` section. Entries are separated by
// a bolded **Company · Role** line. Bullets following each entry become
// that entry's bullets.
function parseExperienceSection(bodyLines) {
  const blocks = []
  let entry = null
  const flush = () => { if (entry) blocks.push(entry); entry = null }

  for (const raw of bodyLines) {
    const ln = raw.trim()
    if (!ln) continue
    const boldMatch = ln.match(/^\*\*([^*]+)\*\*\s*(.*)$/)
    if (boldMatch) {
      flush()
      const headLine = boldMatch[1].trim()
      const rest = boldMatch[2].replace(/^·\s*/, '').trim()
      // headLine is like "Company · Role" or "Company - Role" — split on first separator.
      const sep = headLine.includes('·') ? '·' : (headLine.includes(' — ') ? ' — ' : (headLine.includes(' - ') ? ' - ' : null))
      let company = headLine, role = ''
      if (sep) {
        const parts = headLine.split(sep)
        company = parts[0].trim()
        role = parts.slice(1).join(sep).trim()
      }
      // rest is typically the date range — "June 2024 – Present"
      let start = '', end = ''
      if (rest) {
        const dateMatch = rest.match(/^(.+?)\s*[–-]\s*(.+)$/)
        if (dateMatch) { start = dateMatch[1].trim(); end = dateMatch[2].trim() }
        else { start = rest }
      }
      entry = {
        id: uid(), type: 'experience', included: true,
        data: { company, role, location: '', start, end, bullets: [] },
      }
    } else if (ln.startsWith('- ') || ln.startsWith('• ') || ln.startsWith('* ')) {
      const bulletText = ln.replace(/^[-•*]\s+/, '')
      if (!entry) {
        entry = { id: uid(), type: 'experience', included: true, data: { company: '', role: '', location: '', start: '', end: '', bullets: [] } }
      }
      entry.data.bullets.push({ id: uid('p'), html: inlineMdToHtml(bulletText) })
    } else if (entry) {
      // Continuation — append to last bullet, or stash as a bullet if no bullets yet.
      if (entry.data.bullets.length) {
        const last = entry.data.bullets[entry.data.bullets.length - 1]
        last.html = `${last.html} ${inlineMdToHtml(ln)}`.trim()
      } else {
        entry.data.bullets.push({ id: uid('p'), html: inlineMdToHtml(ln) })
      }
    }
  }
  flush()
  if (!blocks.length) blocks.push(emptyBlock('experience'))
  return blocks
}

function parseEducationSection(bodyLines) {
  const blocks = []
  let entry = null
  const flush = () => { if (entry) blocks.push(entry); entry = null }
  for (const raw of bodyLines) {
    const ln = raw.trim()
    if (!ln) continue
    const boldMatch = ln.match(/^\*\*([^*]+)\*\*\s*(.*)$/)
    if (boldMatch) {
      flush()
      const head = boldMatch[1].trim()
      const rest = boldMatch[2].replace(/^·\s*/, '').trim()
      const parts = rest.split('·').map(s => s.trim()).filter(Boolean)
      entry = {
        id: uid(), type: 'education', included: true,
        data: {
          degree: head,
          school: parts[0] || '',
          location: '',
          start: '', end: parts[1] || '',
          gpa: '', bullets: [],
        },
      }
    } else if (ln.startsWith('- ') || ln.startsWith('• ')) {
      if (!entry) entry = emptyBlock('education')
      entry.data.bullets.push({ id: uid('p'), html: inlineMdToHtml(ln.replace(/^[-•]\s+/, '')) })
    }
  }
  flush()
  return blocks.length ? blocks : [emptyBlock('education')]
}

function parseProjectsSection(bodyLines) {
  const blocks = []
  let entry = null
  const flush = () => { if (entry) blocks.push(entry); entry = null }
  for (const raw of bodyLines) {
    const ln = raw.trim()
    if (!ln) continue
    const boldMatch = ln.match(/^\*\*([^*]+)\*\*\s*(.*)$/)
    if (boldMatch) {
      flush()
      const name = boldMatch[1].trim()
      const tail = boldMatch[2].replace(/^[—\-·]\s*/, '').trim()
      entry = {
        id: uid(), type: 'projects', included: true,
        data: { name, link: '', start: '', end: '', bullets: tail ? [{ id: uid('p'), html: inlineMdToHtml(tail) }] : [] },
      }
    } else if (ln.startsWith('- ') || ln.startsWith('• ')) {
      if (!entry) entry = emptyBlock('projects')
      entry.data.bullets.push({ id: uid('p'), html: inlineMdToHtml(ln.replace(/^[-•]\s+/, '')) })
    }
  }
  flush()
  return blocks.length ? blocks : []
}

// ─── Blocks → plain text (for ATS scoring) ─────────────────────────────
// The ATS heuristic operates on the resume's word bag — we strip all
// HTML and concatenate every field so the scorer sees the same content
// the resume conveys.
function htmlToText(html) {
  if (!html) return ''
  return String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

export function blocksToPlainText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const b of blocks) {
    if (!b?.included) continue
    const d = b.data || {}
    switch (b.type) {
      case 'header':
        parts.push(d.name, d.title, d.location, d.email, d.phone, ...(d.links || []).map(l => l.url || l.label))
        break
      case 'summary': parts.push(htmlToText(d.html)); break
      case 'experience':
        parts.push(d.company, d.role, d.location, d.start, d.end, ...(d.bullets || []).map(p => htmlToText(p.html)))
        break
      case 'education':
        parts.push(d.degree, d.school, d.location, d.start, d.end, d.gpa, ...(d.bullets || []).map(p => htmlToText(p.html)))
        break
      case 'skills':
      case 'certifications':
        parts.push(htmlToText(d.html)); break
      case 'projects':
        parts.push(d.name, d.link, ...(d.bullets || []).map(p => htmlToText(p.html))); break
      case 'custom':
        parts.push(d.title, htmlToText(d.html)); break
      default: break
    }
  }
  return parts.filter(Boolean).join(' ')
}

// Lightweight summary string for resume-card previews on the library page.
export function blocksToPreview(blocks, maxChars = 400) {
  const txt = blocksToPlainText(blocks)
  return txt.length > maxChars ? `${txt.slice(0, maxChars)}…` : txt
}
