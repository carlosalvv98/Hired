import { Plus, X } from 'lucide-react'
import RichTextField from './RichTextField'
import InlineText from './InlineText'
import { uid } from '../../lib/resumeBlocks'

// ─── Generic helpers ───────────────────────────────────────────────────

// Inline text field that grows to fit its content. Wraps the shared
// InlineText (contenteditable span) and adds the optional mono variant.
function InlineInput({ value, onChange, placeholder, className = '', style, mono = false }) {
  return (
    <InlineText
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`${mono ? 'rb-inline-mono' : ''} ${className}`}
      style={style}
    />
  )
}

function setData(block, patch, onChange) {
  onChange({ ...block, data: { ...block.data, ...patch } })
}

function setBullet(block, id, html, onChange) {
  const bullets = (block.data.bullets || []).map(p => p.id === id ? { ...p, html } : p)
  onChange({ ...block, data: { ...block.data, bullets } })
}

function addBullet(block, onChange) {
  const bullets = [...(block.data.bullets || []), { id: uid('p'), html: '' }]
  onChange({ ...block, data: { ...block.data, bullets } })
}

function removeBullet(block, id, onChange) {
  const bullets = (block.data.bullets || []).filter(p => p.id !== id)
  onChange({ ...block, data: { ...block.data, bullets } })
}

// ─── Header ────────────────────────────────────────────────────────────

export function HeaderBlock({ block, onChange }) {
  const d = block.data
  const links = d.links || []
  const setLink = (i, patch) => {
    const next = links.map((l, idx) => idx === i ? { ...l, ...patch } : l)
    setData(block, { links: next }, onChange)
  }
  const addLink = () => setData(block, { links: [...links, { label: '', url: '' }] }, onChange)
  const removeLink = (i) => setData(block, { links: links.filter((_, idx) => idx !== i) }, onChange)

  return (
    <div className="rb-header">
      <InlineInput
        value={d.name}
        onChange={v => setData(block, { name: v }, onChange)}
        placeholder="Full Name"
        className="rb-name"
      />
      <div className="rb-header-meta">
        <InlineInput value={d.title}    onChange={v => setData(block, { title: v }, onChange)}    placeholder="Title (e.g. Product Manager)" />
        <span className="rb-dot">·</span>
        <InlineInput value={d.location} onChange={v => setData(block, { location: v }, onChange)} placeholder="City, State" />
      </div>
      <div className="rb-header-contact">
        <InlineInput value={d.email} onChange={v => setData(block, { email: v }, onChange)} placeholder="email@domain.com" mono />
        <span className="rb-dot">·</span>
        <InlineInput value={d.phone} onChange={v => setData(block, { phone: v }, onChange)} placeholder="(555) 555-5555" mono />
        {links.map((l, i) => (
          <span key={i} className="rb-header-link">
            <span className="rb-dot">·</span>
            <InlineInput value={l.url} onChange={v => setLink(i, { url: v, label: l.label || v })} placeholder="https://…" mono />
            <button type="button" className="rb-link-remove" onClick={() => removeLink(i)} aria-label="Remove link"><X size={11} /></button>
          </span>
        ))}
        <button type="button" className="rb-add-link" onClick={addLink}><Plus size={11} />Link</button>
      </div>
    </div>
  )
}

// ─── Summary / Skills / Certifications (single rich-text block) ────────

export function ProseBlock({ block, onChange, label, placeholder }) {
  return (
    <div className="rb-prose">
      <div className="rb-section-h">{label || 'Section'}</div>
      <RichTextField
        value={block.data.html}
        onChange={html => setData(block, { html }, onChange)}
        placeholder={placeholder || 'Write…'}
        ariaLabel={label}
      />
    </div>
  )
}

// ─── Experience ────────────────────────────────────────────────────────

export function ExperienceBlock({ block, onChange, sectionLabel }) {
  const d = block.data
  return (
    <div className="rb-exp">
      {sectionLabel && <div className="rb-section-h">{sectionLabel}</div>}
      <div className="rb-exp-head">
        <InlineInput
          value={d.company}
          onChange={v => setData(block, { company: v }, onChange)}
          placeholder="Company"
          className="rb-strong"
        />
        <span className="rb-dot">·</span>
        <InlineInput
          value={d.role}
          onChange={v => setData(block, { role: v }, onChange)}
          placeholder="Role / Title"
        />
        <span className="rb-spacer" />
        <InlineInput
          value={d.location}
          onChange={v => setData(block, { location: v }, onChange)}
          placeholder="Location"
          className="rb-muted"
        />
      </div>
      <div className="rb-exp-dates">
        <InlineInput
          value={d.start}
          onChange={v => setData(block, { start: v }, onChange)}
          placeholder="Start (e.g. Jun 2024)"
          mono
        />
        <span className="rb-dash">–</span>
        <InlineInput
          value={d.end}
          onChange={v => setData(block, { end: v }, onChange)}
          placeholder="End (or Present)"
          mono
        />
      </div>
      <ul className="rb-bullets">
        {(d.bullets || []).map(p => (
          <li key={p.id} className="rb-bullet">
            <span className="rb-bullet-marker">•</span>
            <RichTextField
              value={p.html}
              onChange={html => setBullet(block, p.id, html, onChange)}
              placeholder="Describe what you did, the impact, and the metrics"
              ariaLabel="Bullet"
            />
            <button
              type="button"
              className="rb-bullet-remove"
              onClick={() => removeBullet(block, p.id, onChange)}
              aria-label="Remove bullet"
            ><X size={11} /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="rb-add-bullet" onClick={() => addBullet(block, onChange)}>
        <Plus size={12} />Add bullet
      </button>
    </div>
  )
}

// ─── Education ─────────────────────────────────────────────────────────

export function EducationBlock({ block, onChange, sectionLabel }) {
  const d = block.data
  return (
    <div className="rb-edu">
      {sectionLabel && <div className="rb-section-h">{sectionLabel}</div>}
      <div className="rb-exp-head">
        <InlineInput value={d.degree} onChange={v => setData(block, { degree: v }, onChange)} placeholder="Degree" className="rb-strong" />
        <span className="rb-dot">·</span>
        <InlineInput value={d.school} onChange={v => setData(block, { school: v }, onChange)} placeholder="School" />
        <span className="rb-spacer" />
        <InlineInput value={d.location} onChange={v => setData(block, { location: v }, onChange)} placeholder="Location" className="rb-muted" />
      </div>
      <div className="rb-exp-dates">
        <InlineInput value={d.start} onChange={v => setData(block, { start: v }, onChange)} placeholder="Start" mono />
        <span className="rb-dash">–</span>
        <InlineInput value={d.end}   onChange={v => setData(block, { end: v }, onChange)}   placeholder="End" mono />
        {(d.gpa || d.gpa === '') && (
          <>
            <span className="rb-spacer" />
            <InlineInput value={d.gpa} onChange={v => setData(block, { gpa: v }, onChange)} placeholder="GPA (optional)" className="rb-muted" />
          </>
        )}
      </div>
      {(d.bullets || []).length > 0 && (
        <ul className="rb-bullets">
          {d.bullets.map(p => (
            <li key={p.id} className="rb-bullet">
              <span className="rb-bullet-marker">•</span>
              <RichTextField value={p.html} onChange={html => setBullet(block, p.id, html, onChange)} placeholder="Honors, coursework, activities…" ariaLabel="Bullet" />
              <button type="button" className="rb-bullet-remove" onClick={() => removeBullet(block, p.id, onChange)} aria-label="Remove bullet"><X size={11} /></button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="rb-add-bullet" onClick={() => addBullet(block, onChange)}>
        <Plus size={12} />Add line
      </button>
    </div>
  )
}

// ─── Projects ──────────────────────────────────────────────────────────

export function ProjectBlock({ block, onChange, sectionLabel }) {
  const d = block.data
  return (
    <div className="rb-exp">
      {sectionLabel && <div className="rb-section-h">{sectionLabel}</div>}
      <div className="rb-exp-head">
        <InlineInput value={d.name} onChange={v => setData(block, { name: v }, onChange)} placeholder="Project name" className="rb-strong" />
        <span className="rb-spacer" />
        <InlineInput value={d.link} onChange={v => setData(block, { link: v }, onChange)} placeholder="Link (optional)" mono />
      </div>
      <div className="rb-exp-dates">
        <InlineInput value={d.start} onChange={v => setData(block, { start: v }, onChange)} placeholder="Start" mono />
        <span className="rb-dash">–</span>
        <InlineInput value={d.end}   onChange={v => setData(block, { end: v }, onChange)}   placeholder="End" mono />
      </div>
      <ul className="rb-bullets">
        {(d.bullets || []).map(p => (
          <li key={p.id} className="rb-bullet">
            <span className="rb-bullet-marker">•</span>
            <RichTextField value={p.html} onChange={html => setBullet(block, p.id, html, onChange)} placeholder="What you built and why it mattered" ariaLabel="Bullet" />
            <button type="button" className="rb-bullet-remove" onClick={() => removeBullet(block, p.id, onChange)} aria-label="Remove bullet"><X size={11} /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="rb-add-bullet" onClick={() => addBullet(block, onChange)}>
        <Plus size={12} />Add bullet
      </button>
    </div>
  )
}

// ─── Custom (catch-all) ────────────────────────────────────────────────

export function CustomBlock({ block, onChange }) {
  const d = block.data
  return (
    <div className="rb-prose">
      <InlineInput
        value={d.title}
        onChange={v => setData(block, { title: v }, onChange)}
        placeholder="Section title"
        className="rb-section-h-input"
      />
      <RichTextField
        value={d.html}
        onChange={html => setData(block, { html }, onChange)}
        placeholder="Write…"
        ariaLabel="Section content"
      />
    </div>
  )
}

// ─── Dispatcher ────────────────────────────────────────────────────────

export function BlockBody({ block, onChange, isFirstOfType }) {
  switch (block.type) {
    case 'header':         return <HeaderBlock block={block} onChange={onChange} />
    case 'summary':        return <ProseBlock block={block} onChange={onChange} label={isFirstOfType ? 'Summary' : ''} placeholder="A 2–4 sentence professional summary" />
    case 'experience':     return <ExperienceBlock block={block} onChange={onChange} sectionLabel={isFirstOfType ? 'Experience' : ''} />
    case 'education':      return <EducationBlock block={block} onChange={onChange} sectionLabel={isFirstOfType ? 'Education' : ''} />
    case 'skills':         return <ProseBlock block={block} onChange={onChange} label={isFirstOfType ? 'Skills' : ''} placeholder="e.g. Python, SQL, Figma, Stakeholder management" />
    case 'projects':       return <ProjectBlock block={block} onChange={onChange} sectionLabel={isFirstOfType ? 'Projects' : ''} />
    case 'certifications': return <ProseBlock block={block} onChange={onChange} label={isFirstOfType ? 'Certifications' : ''} placeholder="Cert name · Issuer · Year" />
    case 'custom':         return <CustomBlock block={block} onChange={onChange} />
    default:               return null
  }
}
