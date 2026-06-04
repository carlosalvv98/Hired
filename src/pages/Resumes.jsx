import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Plus, Upload, Copy, Loader2, FileText, MoreHorizontal, Trash2, X } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import {
  listResumes, createResume, duplicateResume,
  uploadResumeFile, updateResume,
} from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import { confirmToast } from '../lib/confirmToast'
import { parseResumeFromFile } from '../lib/agents/resumeImporter'
import { trackUsage } from '../lib/ai'
import { relTime } from '../lib/time'
import toast from 'react-hot-toast'

const STARTER = `# Your Name
Senior Software Engineer · City

## Summary
Senior engineer with X years of experience…

## Experience
**Company · Senior Engineer**  · 2023 – Present
- Bullet 1
- Bullet 2

## Education
**B.S. Computer Science** · University · Year

## Skills
TypeScript · Go · Postgres · React
`

const ACCEPTED_TYPES = '.pdf,.docx,.doc,.md,.txt'

export default function Resumes() {
  const { user } = useAuth()
  const nav = useNavigate()
  const { openUpgrade } = useUI()
  const { allowed: importAllowed, refresh: refreshImportLimit } = useLimit('resume_imports')

  const [resumes, setResumes] = useState([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const fileInputRef = useRef(null)

  const toggleSelected = (id, e) => {
    e?.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  const onBulkDelete = async () => {
    const ids = [...selectedIds]
    if (!ids.length) return
    const ok = await confirmToast(
      `Delete ${ids.length} resume${ids.length === 1 ? '' : 's'}? This can't be undone.`,
      { title: 'Delete resumes', confirmLabel: 'Delete', tone: 'danger' }
    )
    if (!ok) return
    setResumes(prev => prev.filter(r => !ids.includes(r.id)))
    try {
      await Promise.all(ids.map(id => updateResume(id, { archived: true })))
      toast.success(`Deleted ${ids.length}`)
      clearSelection()
    } catch {
      toast.error('Some deletes failed')
      load()
    }
  }

  const load = async () => {
    setLoading(true)
    try { setResumes(await listResumes()) } catch { toast.error('Could not load resumes') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  // "New" goes to a draft editor — we only insert a row into the DB once
  // the user actually edits something. Clicking New + back-button no
  // longer leaves empty Resume rows behind.
  const onNew = () => { nav('/resumes/new') }

  // Import flow: a PDF can be parsed by AI (gated). Other formats are
  // attached as-is so the user can edit the markdown manually. We always
  // create the row first (so the upload path can reference its id), then
  // attempt the AI parse on top.
  const onImport = async (file) => {
    if (!file || importing) return
    setImporting(true)
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    try {
      const stub = await createResume({
        name: file.name.replace(/\.(pdf|docx?|md|txt)$/i, '') || `Imported resume`,
        version: `v${resumes.length + 1}`,
        content_md: '',
        source: isPdf ? 'ai_imported' : 'upload',
        file_name: file.name,
        file_size_bytes: file.size,
        file_mime: file.type || null,
      }, user.id)

      let fileMeta
      try {
        fileMeta = await uploadResumeFile(file, user.id, stub.id)
      } catch (err) {
        toast.error(`Upload failed: ${err.message}`)
        setImporting(false)
        return
      }
      await updateResume(stub.id, {
        file_url: fileMeta.path,
        file_mime: fileMeta.mime || stub.file_mime,
      })

      if (isPdf) {
        // AI parse path — gate on quota first, fall through to the
        // editor with empty content if the user has hit the limit.
        if (!guardLimit({ allowed: importAllowed, feature: 'resume_imports', openUpgrade })) {
          toast('Saved without AI parse. Edit manually or upgrade for AI imports.', { duration: 4500 })
          nav(`/resumes/${stub.id}`)
          return
        }
        toast.loading('Parsing your resume with AI…', { id: 'res-import' })
        try {
          const { blocks, name: derivedName, _usage } = await parseResumeFromFile(fileMeta.path)
          await updateResume(stub.id, { content_blocks: blocks, name: derivedName || stub.name })
          if (user?.id) {
            await trackUsage(user.id, 'resume_imports', _usage.model, _usage.inputTokens, _usage.outputTokens)
            refreshImportLimit()
          }
          toast.success('Resume imported', { id: 'res-import' })
        } catch (err) {
          toast.error(err.message || 'AI parse failed', { id: 'res-import' })
        }
      } else {
        toast.success('Resume uploaded — fill in the editable copy.')
      }
      nav(`/resumes/${stub.id}`)
    } catch (err) {
      toast.error(err.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const onPickFile = () => fileInputRef.current?.click()
  const onFileChange = (e) => {
    const f = e.target.files?.[0]
    if (f) onImport(f)
    e.target.value = ''
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onImport(f)
  }

  const onDuplicate = async (r, e) => {
    e?.stopPropagation()
    try {
      const copy = await duplicateResume(r.id, user.id)
      toast.success('Duplicated')
      nav(`/resumes/${copy.id}`)
    } catch { toast.error('Could not duplicate') }
  }

  const onDelete = async (r, e) => {
    e?.stopPropagation()
    const ok = await confirmToast(`Delete "${r.name}"?`,
      { confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    try {
      await updateResume(r.id, { archived: true })
      setResumes(prev => prev.filter(x => x.id !== r.id))
      toast.success('Deleted')
    } catch { toast.error('Could not delete') }
  }

  return (
    <>
      <AppBar title="Resumes" crumbs={`resumes · ${resumes.length} version${resumes.length === 1 ? '' : 's'}`} />
      <PageActions right={
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          <button className="btn ghost tiny" onClick={onPickFile} disabled={importing}>
            {importing ? <><Loader2 size={13} className="spin" />Importing…</> : <><Upload size={13} />Import</>}
          </button>
          <button className="btn primary tiny" onClick={onNew}>
            <Plus size={13} />New
          </button>
        </>
      } />
      {selectedIds.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count"><strong>{selectedIds.size}</strong> selected</span>
          <button className="btn ghost tiny" onClick={clearSelection}>
            <X size={12} />Clear
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost tiny" onClick={onBulkDelete} style={{ color: 'var(--bad)' }}>
            <Trash2 size={12} />Delete
          </button>
        </div>
      )}
      <div
        className={`content ${dragOver ? 'drag-target' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}>
        {dragOver && (
          <div className="resumes-drop-overlay">
            <div className="resumes-drop-inner">
              <Upload size={28} />
              <div>Drop a PDF or .docx to import</div>
            </div>
          </div>
        )}
        <div className="resume-grid">
          <div className="resume-card create" onClick={onNew}>
            <div className="ico-big"><Sparkles size={20} /></div>
            <h4>Create from scratch</h4>
            <p>Start with a clean template, then tailor each version to a specific role.</p>
            <div className="mono" style={{ fontSize: 10, color: 'var(--accent)', marginTop: 6, fontWeight: 600, letterSpacing: '0.08em' }}>
              ↗ 5 MIN
            </div>
          </div>
          {loading ? (
            [1,2,3].map(i => <div key={i} className="card skel" style={{ height: 320 }} />)
          ) : resumes.map(r => {
            const selected = selectedIds.has(r.id)
            return (
              <div key={r.id} className={`resume-card ${selected ? 'selected' : ''}`}
                onClick={() => nav(`/resumes/${r.id}`)}>
                <label className="resume-card-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="tbl-check"
                    checked={selected}
                    onChange={(e) => toggleSelected(r.id, e)}
                    aria-label={`Select ${r.name}`}
                  />
                </label>
                <div className="preview">
                  <MiniResume row={r} />
                </div>
                <div className="meta">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h4 style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                        {r.source === 'ai_imported' && <span className="tag indigo" style={{ fontSize: 9, flexShrink: 0 }}><Sparkles size={8} />AI</span>}
                        {r.source === 'upload' && <span className="tag" style={{ fontSize: 9, flexShrink: 0 }}><FileText size={8} />File</span>}
                      </h4>
                      <div className="sub" style={{ fontSize: 10.5 }}>{r.version || '—'} · {relTime(r.created_at)}</div>
                    </div>
                    <ResumeRowMenu
                      onDuplicate={(e) => onDuplicate(r, e)}
                      onDelete={(e) => onDelete(r, e)}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

// Three-dot menu rendered in the corner of each resume card.
function ResumeRowMenu({ onDuplicate, onDelete }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button className="btn ghost icon" onClick={() => setOpen(v => !v)} title="Actions">
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{
            position: 'absolute', top: '100%', right: 0, zIndex: 60, marginTop: 4,
            background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)', minWidth: 150, padding: 4,
          }}>
            <button className="status-menu-item" onClick={(e) => { setOpen(false); onDuplicate(e) }}>
              <Copy size={12} style={{ marginRight: 8 }} />Duplicate
            </button>
            <button className="status-menu-item" onClick={(e) => { setOpen(false); onDelete(e) }} style={{ color: 'var(--bad)' }}>
              <Trash2 size={12} style={{ marginRight: 8 }} />Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Tiny rendered preview shown inside each resume card on the library page.
// Handles both the new block format and legacy `content_md`.
function MiniResume({ row }) {
  const blocks = Array.isArray(row?.content_blocks) && row.content_blocks.length
    ? row.content_blocks
    : null

  if (blocks) {
    const visible = blocks.filter(b => b.included).slice(0, 6)
    return (
      <div className="mini-resume">
        {visible.map(b => {
          const d = b.data || {}
          if (b.type === 'header') {
            return (
              <div key={b.id}>
                <div className="mini-name">{d.name || 'Your name'}</div>
                {(d.title || d.location) && <div className="mini-sub">{[d.title, d.location].filter(Boolean).join(' · ')}</div>}
              </div>
            )
          }
          if (b.type === 'summary') {
            return (
              <div key={b.id}>
                <div className="mini-h">Summary</div>
                <div className="mini-line">{stripHtml(d.html).slice(0, 80)}</div>
              </div>
            )
          }
          if (b.type === 'experience') {
            return (
              <div key={b.id}>
                <div className="mini-h">Experience</div>
                <div className="mini-strong">{[d.company, d.role].filter(Boolean).join(' · ').slice(0, 40)}</div>
                {(d.bullets || []).slice(0, 2).map(p => (
                  <div key={p.id} className="mini-bullet">• {stripHtml(p.html).slice(0, 50)}</div>
                ))}
              </div>
            )
          }
          if (b.type === 'education') {
            return (
              <div key={b.id}>
                <div className="mini-h">Education</div>
                <div className="mini-strong">{[d.degree, d.school].filter(Boolean).join(' · ').slice(0, 40)}</div>
              </div>
            )
          }
          if (b.type === 'skills') {
            return (
              <div key={b.id}>
                <div className="mini-h">Skills</div>
                <div className="mini-line">{stripHtml(d.html).slice(0, 60)}</div>
              </div>
            )
          }
          return null
        })}
      </div>
    )
  }

  // Legacy: render the old markdown preview.
  const lines = (row?.content_md || '').split('\n').slice(0, 14)
  return (
    <div style={{ padding: '20px 22px', fontSize: 9, lineHeight: 1.4, color: 'var(--ink-2)' }}>
      {lines.map((l, i) => {
        if (l.startsWith('# ')) return <div key={i} style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{l.slice(2)}</div>
        if (l.startsWith('## ')) return <div key={i} style={{ fontSize: 9, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 6 }}>{l.slice(3)}</div>
        if (l.startsWith('**')) return <div key={i} style={{ fontWeight: 600, marginTop: 4 }}>{l.replace(/\*\*/g, '').slice(0, 50)}</div>
        if (l.startsWith('- ')) return <div key={i} style={{ paddingLeft: 6 }}>• {l.slice(2).slice(0, 60)}</div>
        return <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.slice(0, 60)}</div>
      })}
    </div>
  )
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}
