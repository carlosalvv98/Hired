import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Download, Sparkles, Table, KanbanSquare, LayoutGrid, ChevronDown, GripVertical, ExternalLink, FileText, X, Trash2, Upload, Loader2 } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import Logo from '../components/Logo'
import { domainFromUrl } from '../lib/logos'
import StatusPill from '../components/StatusPill'
import { StageDropdown } from '../components/Drawer'
import Rating from '../components/Rating'
import IvProgress from '../components/IvProgress'
import AddJobModal, { JOB_URL_PLACEHOLDER } from '../components/AddJobModal'
import { listApplications, updateApplication, setStage, autoSetStage, listSteps, listResumes, deleteApplication, createResume, uploadResumeFile, updateResume } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { parseResumeFromFile } from '../lib/agents/resumeImporter'
import { trackUsage } from '../lib/ai'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import { confirmToast } from '../lib/confirmToast'
import { STAGES, STAGE_LABEL, formatSalary } from '../lib/stages'
import { relTime, shortDate } from '../lib/time'
import { useUI } from '../hooks/useUI'
import toast from 'react-hot-toast'

const COLS = [
  { k: 'select',   label: '',                   w: 32,  align: 'center', fixed: true },
  { k: 'star',     label: '★',                  w: 92,  align: 'left' },
  { k: 'role',     label: 'Role / Company',     w: 260, align: 'left' },
  { k: 'loc',      label: 'Location',           w: 90,  align: 'left' },
  { k: 'mode',     label: 'Remote?',            w: 90,  align: 'left' },
  { k: 'status',   label: 'Status',             w: 112, align: 'left' },
  { k: 'salary',   label: 'Salary range',       w: 130, align: 'left' },
  { k: 'progress', label: 'Interview progress', w: 220, align: 'left' },
  { k: 'resume',   label: 'Resume',             w: 100, align: 'left' },
  { k: 'applied',  label: 'Applied',            w: 90,  align: 'left' },
  { k: 'source',   label: 'Source',             w: 96,  align: 'left' },
  { k: 'last',     label: 'Last activity',      w: 100, align: 'right' },
  { k: 'link',     label: 'JD',                 w: 36,  align: 'center' },
]

// Map column key → field on an application row for sorting. Columns not
// listed here can't be sorted (selection / progress / link / star).
const SORT_FIELD = {
  role:    a => (a.role_title || '').toLowerCase(),
  loc:     a => (a.location_text || '').toLowerCase(),
  mode:    a => a.mode || '',
  status:  a => a.stage || '',
  salary:  a => a.salary_max || a.salary_min || 0,
  resume:  a => a.resume?.name?.toLowerCase() || '',
  applied: a => a.applied_at ? new Date(a.applied_at).getTime() : 0,
  source:  a => (a.source || '').toLowerCase(),
  last:    a => a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0,
}

const STOP_PROP = new Set(['select', 'star', 'source', 'link', 'resume', 'status'])

// Terminal "dead" stages — moving into one of these auto-archives the
// application (and surfaces a toast) since there's nothing left to track.
const ARCHIVING_STAGES = new Set(['reject', 'closed'])

// Auto-ghost / auto-close rule. In-flight apps with no activity for
// GHOST_DAYS get moved to Ghosted; once idle for CLOSE_DAYS they're Closed
// (archived). Driven off last_activity_at, evaluated client-side on load.
const IN_FLIGHT_STAGES = ['applied', 'screen', 'iv', 'final']
const GHOST_DAYS = 30
const CLOSE_DAYS = 60
const DAY_MS = 86_400_000

// Returns the transitions a stale sweep would make: [{ id, from, to, archive, app }].
function evaluateStale(list) {
  const now = Date.now()
  const out = []
  for (const a of list) {
    if (a.archived || !a.last_activity_at) continue
    const idle = (now - new Date(a.last_activity_at).getTime()) / DAY_MS
    const inFlight = IN_FLIGHT_STAGES.includes(a.stage)
    if ((inFlight || a.stage === 'ghost') && idle >= CLOSE_DAYS) {
      out.push({ id: a.id, from: a.stage, to: 'closed', archive: true, app: a })
    } else if (inFlight && idle >= GHOST_DAYS) {
      out.push({ id: a.id, from: a.stage, to: 'ghost', archive: false, app: a })
    }
  }
  return out
}

// Should we auto-stamp applied_at on this stage change? Yes when moving
// from "new" (or no applied date) into any stage that means the user has
// actually applied. Doesn't overwrite an existing applied_at.
function needsAppliedStamp(row, nextStage) {
  if (row.applied_at) return false
  if (nextStage === 'new' || nextStage === 'reject' || nextStage === 'ghost') return false
  return true
}

export default function Tracker() {
  const [view, setView] = useState('table')
  const [density, setDensity] = useState('regular')
  const [apps, setApps] = useState([])
  const [steps, setSteps] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({})
  const [statusFilterOpen, setStatusFilterOpen] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [addSeedUrl, setAddSeedUrl] = useState('')
  const [addManual, setAddManual] = useState(false)
  const [resumePickerFor, setResumePickerFor] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkStageOpen, setBulkStageOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const [params, setParams] = useSearchParams()
  const { openDrawer } = useUI()
  // Run the stale sweep only once per mount, on the live (non-archived) view.
  const autoSweepDone = useRef(false)

  const load = async () => {
    setLoading(true)
    try {
      const a = await listApplications({ archived: showArchived })
      setApps(a)
      const stepsByApp = {}
      await Promise.all(a.map(async app => {
        try { stepsByApp[app.id] = await listSteps(app.id) } catch { stepsByApp[app.id] = [] }
      }))
      setSteps(stepsByApp)
      if (!showArchived && !autoSweepDone.current) {
        autoSweepDone.current = true
        runStaleSweep(a)
      }
    } catch (e) {
      toast.error('Could not load applications')
    } finally { setLoading(false) }
  }

  // Auto-move idle in-flight apps to Ghosted / Closed, then offer one Undo.
  const runStaleSweep = async (list) => {
    const transitions = evaluateStale(list)
    if (!transitions.length) return
    const before = transitions.map(t => ({ id: t.id, stage: t.from, archived: !!t.app.archived }))

    setApps(prev => {
      const archivedIds = new Set(transitions.filter(t => t.archive).map(t => t.id))
      const next = prev.map(a => {
        const t = transitions.find(x => x.id === a.id)
        return t ? { ...a, stage: t.to, ...(t.archive ? { archived: true } : {}) } : a
      })
      return showArchived ? next : next.filter(a => !archivedIds.has(a.id))
    })

    try {
      await Promise.all(transitions.map(t => autoSetStage(t.id, t.to, t.archive ? true : undefined)))
    } catch { toast.error('Auto-update failed'); load(); return }

    const nGhost = transitions.filter(t => t.to === 'ghost').length
    const nClose = transitions.filter(t => t.to === 'closed').length
    const parts = []
    if (nGhost) parts.push(`${nGhost} ghosted`)
    if (nClose) parts.push(`${nClose} closed`)
    toast((tt) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>Auto-updated {parts.join(' · ')} — inactive {GHOST_DAYS}+ days</span>
        <button className="btn ghost tiny" onClick={() => { toast.dismiss(tt.id); undoStaleSweep(before) }}>Undo</button>
      </span>
    ), { duration: 8000 })
  }

  const undoStaleSweep = async (before) => {
    try {
      await Promise.all(before.map(b => autoSetStage(b.id, b.stage, b.archived)))
      toast.success('Reverted')
      load()
    } catch { toast.error('Could not undo'); load() }
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showArchived])

  useEffect(() => {
    if (params.get('addjob') === '1') {
      setShowAdd(true)
      const next = new URLSearchParams(params)
      next.delete('addjob')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  const filtered = useMemo(() => {
    let out = apps
    if (filter.stage) out = out.filter(a => a.stage === filter.stage)
    if (sort.key && SORT_FIELD[sort.key]) {
      const accessor = SORT_FIELD[sort.key]
      const mult = sort.dir === 'desc' ? -1 : 1
      out = [...out].sort((a, b) => {
        const va = accessor(a)
        const vb = accessor(b)
        if (va < vb) return -1 * mult
        if (va > vb) return  1 * mult
        return 0
      })
    }
    return out
  }, [apps, filter, sort])

  const onSetRating = async (id, rating) => {
    setApps(prev => prev.map(a => a.id === id ? { ...a, rating } : a))
    try { await updateApplication(id, { rating }) }
    catch { toast.error('Failed to save rating'); load() }
  }

  const onCreated = (app) => {
    load()
    setTimeout(() => openDrawer(app.id), 200)
  }

  // Single source of truth for a one-off status change (table + kanban).
  // Stamps applied_at when crossing into an applied stage, and auto-archives
  // when moving into a terminal stage (Rejected / Closed).
  const applyStageChange = async (id, stage) => {
    const row = apps.find(a => a.id === id)
    if (!row) return
    const stamp = needsAppliedStamp(row, stage)
    const archive = ARCHIVING_STAGES.has(stage) && !row.archived
    const now = new Date().toISOString()
    setApps(prev => {
      const updated = prev.map(a => a.id === id
        ? { ...a, stage, applied_at: stamp ? now : a.applied_at, ...(archive ? { archived: true, archived_at: now } : {}) }
        : a)
      // When archiving and we're not in the archived view, drop the row.
      return archive && !showArchived ? updated.filter(a => a.id !== id) : updated
    })
    try {
      await setStage(id, stage)
      if (stamp) await updateApplication(id, { applied_at: now })
      if (archive) {
        await updateApplication(id, { archived: true, archived_at: now })
        toast.success(`Archived — moved to ${STAGE_LABEL[stage]}`)
      }
    } catch { toast.error('Could not change status'); load() }
  }

  // Selection helpers — Set wrapped in state, but always rebuild it on
  // mutation so React picks up the change. lastClickedIndex powers
  // shift-click range selection.
  const lastClickedIndex = useRef(null)
  const toggleSelect = (id, shift, rowIndex, visibleApps) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (shift && lastClickedIndex.current != null && visibleApps) {
        const [a, b] = [lastClickedIndex.current, rowIndex].sort((x, y) => x - y)
        for (let i = a; i <= b; i++) next.add(visibleApps[i].id)
      } else {
        next.has(id) ? next.delete(id) : next.add(id)
      }
      lastClickedIndex.current = rowIndex
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())
  const selectAllVisible = (visibleApps) => setSelectedIds(new Set(visibleApps.map(a => a.id)))

  const onBulkStage = async (stage) => {
    const ids = [...selectedIds]
    if (!ids.length) return
    setBulkStageOpen(false)
    const now = new Date().toISOString()
    const archive = ARCHIVING_STAGES.has(stage)
    // Optimistic — stamp applied_at for any row crossing into a post-"new"
    // stage, and archive (drop from view) for terminal stages.
    setApps(prev => {
      const updated = prev.map(a => ids.includes(a.id)
        ? { ...a, stage, applied_at: needsAppliedStamp(a, stage) ? now : a.applied_at, ...(archive ? { archived: true, archived_at: now } : {}) }
        : a)
      return archive && !showArchived ? updated.filter(a => !ids.includes(a.id)) : updated
    })
    try {
      await Promise.all(ids.map(async (id) => {
        const row = apps.find(a => a.id === id)
        await setStage(id, stage)
        if (row && needsAppliedStamp(row, stage)) {
          await updateApplication(id, { applied_at: now })
        }
        if (archive && !row?.archived) {
          await updateApplication(id, { archived: true, archived_at: now })
        }
      }))
      toast.success(archive
        ? `Archived ${ids.length} — moved to ${STAGE_LABEL[stage]}`
        : `Updated ${ids.length} application${ids.length === 1 ? '' : 's'}`)
      clearSelection()
    } catch {
      toast.error('Some updates failed')
      load()
    }
  }

  const onBulkDelete = async () => {
    const ids = [...selectedIds]
    if (!ids.length) return
    const ok = await confirmToast(
      `Delete ${ids.length} application${ids.length === 1 ? '' : 's'}? This can't be undone.`,
      { confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    setApps(prev => prev.filter(a => !ids.includes(a.id)))
    try {
      await Promise.all(ids.map(id => deleteApplication(id)))
      toast.success(`Deleted ${ids.length}`)
      clearSelection()
    } catch {
      toast.error('Some deletes failed')
      load()
    }
  }

  const onExport = () => {
    const rows = [['Company', 'Role', 'Stage', 'Location', 'Mode', 'Salary', 'Applied']]
    apps.forEach(a => rows.push([
      a.company?.name || '',
      a.role_title,
      a.stage,
      a.location_text || '',
      a.mode || '',
      formatSalary(a.salary_min, a.salary_max),
      a.applied_at || '',
    ]))
    const csv = rows.map(r => r.map(x => `"${(x || '').toString().replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `hired-tracker-${new Date().toISOString().slice(0,10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('Exported CSV')
  }

  return (
    <>
      <AppBar title="Tracker" crumbs={`tracker · ${view}${showArchived ? ' · archived' : ''}`} />
      <PageActions
        left={
          <div className="tracker-addbar">
            <div className="tracker-addbar-h">
              <Sparkles size={13} color="var(--accent)" />
              <span>Add a job in 1 click</span>
              <span className="tracker-addbar-eyebrow">· paste link, AI fills the rest</span>
            </div>
            <form className="parse-input tracker-add"
              onSubmit={(e) => {
                e.preventDefault()
                const u = addUrl.trim()
                if (!u) return
                setAddSeedUrl(u); setAddManual(false); setShowAdd(true)
              }}>
              <input type="url" value={addUrl} onChange={e => setAddUrl(e.target.value)}
                placeholder={JOB_URL_PLACEHOLDER} spellCheck={false} />
              <button className="btn ai" type="submit" disabled={!addUrl.trim()}>
                <Sparkles size={12} />Auto-fill
              </button>
            </form>
          </div>
        }
        right={
          <>
            <button className={`btn ghost tiny ${showArchived ? 'on' : ''}`}
              onClick={() => setShowArchived(v => !v)}
              title={showArchived ? 'Showing archived applications' : 'Show archived applications'}>
              {showArchived ? 'Showing archived' : 'Show archived'}
            </button>
            <button className="btn primary tiny" onClick={() => { setAddSeedUrl(''); setAddManual(true); setShowAdd(true) }}>
              <Plus size={13} />Add manually
            </button>
          </>
        } />
      <div className="tracker-tools">
        <div className="seg">
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}><Table size={13} />Table</button>
          <button className={view === 'kanban' ? 'on' : ''} onClick={() => setView('kanban')}><KanbanSquare size={13} />Kanban</button>
          <button className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')}><LayoutGrid size={13} />Cards</button>
        </div>
        <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 4px' }} />
        <div style={{ position: 'relative', zIndex: statusFilterOpen ? 60 : 'auto' }}>
          <span className={`chip ${filter.stage ? 'on' : ''}`} onClick={() => setStatusFilterOpen(v => !v)}>
            Status{filter.stage ? `: ${STAGES.find(s => s.k === filter.stage)?.n || filter.stage}` : ''} <ChevronDown size={11} />
          </span>
          {statusFilterOpen && (
            <>
              <div onClick={() => setStatusFilterOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'transparent' }} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 60,
                background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 180, padding: 4,
              }}>
                <button className={`status-menu-item ${!filter.stage ? 'on' : ''}`}
                  onClick={() => { setFilter({ ...filter, stage: undefined }); setStatusFilterOpen(false) }}>
                  All statuses
                </button>
                {STAGES.map(s => (
                  <button key={s.k} className={`status-menu-item ${filter.stage === s.k ? 'on' : ''}`}
                    onClick={() => { setFilter({ ...filter, stage: s.k }); setStatusFilterOpen(false) }}>
                    <span style={{ background: s.color, width: 6, height: 6, borderRadius: '50%', display: 'inline-block', marginRight: 8 }} />
                    {s.n}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <span style={{ flex: 1 }} />
        <span className="mono muted" style={{ fontSize: 11 }}>{filtered.length} of {apps.length}</span>
        <div className="seg">
          <button className={density === 'compact' ? 'on' : ''} onClick={() => setDensity('compact')}>Compact</button>
          <button className={density === 'regular' ? 'on' : ''} onClick={() => setDensity('regular')}>Regular</button>
        </div>
        <button className="btn ghost tiny" onClick={onExport}><Download size={13} />Export</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1,2,3].map(i => <div key={i} className="skel" style={{ height: 48 }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyTracker onAdd={() => setShowAdd(true)} />
        ) : view === 'table' ? (
          <>
            {selectedIds.size > 0 && (
              <BulkBar
                count={selectedIds.size}
                stageMenuOpen={bulkStageOpen}
                onToggleStageMenu={() => setBulkStageOpen(v => !v)}
                onCloseStageMenu={() => setBulkStageOpen(false)}
                onPickStage={onBulkStage}
                onDelete={onBulkDelete}
                onClear={clearSelection}
              />
            )}
            <TrackerTable
              apps={filtered}
              steps={steps}
              density={density}
              onOpen={openDrawer}
              onSetRating={onSetRating}
              onPickResume={(id) => setResumePickerFor(id)}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onSelectAll={() => selectAllVisible(filtered)}
              onClearSelection={clearSelection}
              sort={sort}
              onSort={(key) => setSort(prev => prev.key === key
                ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { key, dir: 'asc' })}
              onChangeStage={applyStageChange}
            />
          </>
        ) : view === 'kanban' ? (
          <TrackerKanban apps={filtered} onOpen={openDrawer} onMove={applyStageChange} />
        ) : (
          <TrackerCards apps={filtered} onOpen={openDrawer} />
        )}
      </div>

      {showAdd && <AddJobModal
        defaultUrl={addSeedUrl}
        startManual={addManual}
        onClose={() => { setShowAdd(false); setAddSeedUrl(''); setAddManual(false); setAddUrl('') }}
        onCreated={onCreated}
      />}
      {resumePickerFor && (
        <ResumePickerModal
          applicationId={resumePickerFor}
          currentId={apps.find(a => a.id === resumePickerFor)?.resume?.id}
          onClose={() => setResumePickerFor(null)}
          onPicked={async (resumeId) => {
            try {
              await updateApplication(resumePickerFor, { resume_id: resumeId })
              toast.success('Resume attached')
              setResumePickerFor(null)
              load()
            } catch { toast.error('Could not attach resume') }
          }}
        />
      )}
    </>
  )
}

function ResumePickerModal({ applicationId, currentId, onClose, onPicked }) {
  const nav = useNavigate()
  const { user } = useAuth()
  const { openUpgrade } = useUI()
  const { allowed: importAllowed, refresh: refreshImportLimit } = useLimit('resume_imports')
  const [list, setList] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { listResumes().then(setList).catch(() => setList([])) }, [])

  // Same upload + AI-parse flow as the Resumes page — see Resumes.jsx for
  // the long-form version of this code.
  const onUpload = async (file) => {
    if (!file || uploading) return
    setUploading(true)
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    try {
      const stub = await createResume({
        name: file.name.replace(/\.(pdf|docx?|md|txt)$/i, '') || 'Imported resume',
        version: `v${(list?.length || 0) + 1}`,
        content_md: '',
        source: isPdf ? 'ai_imported' : 'upload',
        file_name: file.name,
        file_size_bytes: file.size,
        file_mime: file.type || null,
      }, user.id)
      const fileMeta = await uploadResumeFile(file, user.id, stub.id)
      await updateResume(stub.id, { file_url: fileMeta.path, file_mime: fileMeta.mime })

      if (isPdf && guardLimit({ allowed: importAllowed, feature: 'resume_imports', openUpgrade })) {
        toast.loading('Parsing your resume with AI…', { id: 'tr-res-import' })
        try {
          const { blocks, name: derivedName, _usage } = await parseResumeFromFile(fileMeta.path)
          await updateResume(stub.id, { content_blocks: blocks, name: derivedName || stub.name })
          if (user?.id) {
            await trackUsage(user.id, 'resume_imports', _usage.model, _usage.inputTokens, _usage.outputTokens)
            refreshImportLimit()
          }
          toast.success('Resume imported', { id: 'tr-res-import' })
        } catch (err) {
          toast.error(err.message || 'AI parse failed', { id: 'tr-res-import' })
        }
      } else if (!isPdf) {
        toast.success('Resume uploaded')
      }
      onPicked(stub.id)
    } catch (err) {
      toast.error(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 460 }}>
        <div className="modal-head">
          <h3>Attach a resume</h3>
          <button className="btn ghost icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {list == null ? (
            <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
          ) : list.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>You don't have any resumes yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map(r => (
                <button key={r.id} className="card card-pad"
                  onClick={() => onPicked(r.id)}
                  style={{
                    padding: 12, textAlign: 'left', cursor: 'pointer',
                    borderColor: r.id === currentId ? 'var(--accent)' : undefined,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileText size={14} color="var(--ink-3)" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.version || ''}</div>
                    </div>
                    {r.id === currentId && <span className="tag indigo">attached</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
          <input
            ref={fileRef} type="file"
            accept=".pdf,.docx,.doc,.md,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }}
            style={{ display: 'none' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <button className="btn ghost lg" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
              {uploading ? 'Uploading…' : 'Upload file'}
            </button>
            <button className="btn ghost lg" onClick={() => { onClose(); nav('/resumes') }}>
              <Plus size={13} />New from scratch
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyTracker({ onAdd }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div className="card spotlight" style={{ width: 480, padding: 28, textAlign: 'center' }}>
        <div style={{
          width: 44, height: 44, margin: '0 auto 14px',
          background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}>
          <Sparkles size={20} />
        </div>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Paste your first job link</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 8, marginBottom: 16, lineHeight: 1.5 }}>
          AI fills company, role, location, and salary in seconds. Interview steps come from other Hired users who've applied to the same listing.
        </p>
        <button className="btn indigo lg" onClick={onAdd}><Plus size={14} />Add a job</button>
      </div>
    </div>
  )
}

function TrackerTable({
  apps, steps, density, onOpen, onSetRating, onPickResume, onChangeStage,
  selectedIds, onToggleSelect, onSelectAll, onClearSelection,
  sort, onSort,
}) {
  const [order, setOrder] = useState(() => COLS.map(c => c.k))
  const [dragKey, setDragKey] = useState(null)
  const [overKey, setOverKey] = useState(null)
  const [openStageId, setOpenStageId] = useState(null)
  const allSelected = apps.length > 0 && apps.every(a => selectedIds.has(a.id))
  const someSelected = !allSelected && apps.some(a => selectedIds.has(a.id))
  const colMap = useMemo(() => Object.fromEntries(COLS.map(c => [c.k, c])), [])
  const cols = order.map(k => colMap[k]).filter(Boolean)
  const padY = density === 'compact' ? 7 : 11

  const onDragStart = (k) => (e) => { setDragKey(k); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver = (k) => (e) => { e.preventDefault(); if (overKey !== k) setOverKey(k) }
  const onDrop = (k) => (e) => {
    e.preventDefault()
    const from = dragKey
    setDragKey(null); setOverKey(null)
    if (!from || from === k) return
    setOrder(prev => {
      const next = prev.filter(x => x !== from)
      next.splice(next.indexOf(k), 0, from)
      try { localStorage.setItem('hired.trackerCols', JSON.stringify(next)) } catch {}
      return next
    })
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="tbl tbl-reorderable">
          <thead>
            <tr>
              {cols.map(c => {
                if (c.k === 'select') {
                  return (
                    <th key={c.k} style={{ width: c.w, textAlign: c.align }}>
                      <input type="checkbox"
                        className="tbl-check"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected }}
                        onChange={() => allSelected ? onClearSelection() : onSelectAll()}
                        onClick={e => e.stopPropagation()}
                        aria-label="Select all rows"
                      />
                    </th>
                  )
                }
                const sortable = !!SORT_FIELD[c.k]
                const active = sort?.key === c.k
                return (
                  <th key={c.k} draggable
                    onDragStart={onDragStart(c.k)} onDragOver={onDragOver(c.k)} onDrop={onDrop(c.k)}
                    onDragEnd={() => { setDragKey(null); setOverKey(null) }}
                    onClick={sortable ? () => onSort?.(c.k) : undefined}
                    className={`th-drag ${sortable ? 'th-sortable' : ''} ${active ? 'th-sorted' : ''} ${dragKey === c.k ? 'th-dragging' : ''} ${overKey === c.k && dragKey && dragKey !== c.k ? 'th-over' : ''}`}
                    style={{ width: c.w, textAlign: c.align }}>
                    <span className="th-inner">
                      <span className="th-grip"><GripVertical size={11} /></span>
                      <span>{c.label}</span>
                      {active && (
                        <span className="th-sort-ind">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {apps.map((a, rowIndex) => (
              <tr key={a.id}
                className={`s-${a.stage} ${selectedIds.has(a.id) ? 'row-selected' : ''} ${openStageId === a.id ? 'stage-open' : ''}`}
                // Lift the row whose status menu is open above later rows —
                // dimmed (reject/ghost/closed) rows create a stacking context
                // via opacity that would otherwise bury the dropdown.
                style={openStageId === a.id ? { position: 'relative', zIndex: 30 } : undefined}
                onClick={() => onOpen(a.id)}>
                {cols.map(c => (
                  <td key={c.k}
                    style={{ padding: `${padY}px 10px`, textAlign: c.align }}
                    onClick={STOP_PROP.has(c.k) ? (e) => e.stopPropagation() : undefined}>
                    {c.k === 'select' ? (
                      <input type="checkbox"
                        className="tbl-check"
                        checked={selectedIds.has(a.id)}
                        onChange={(e) => onToggleSelect(a.id, e.nativeEvent.shiftKey, rowIndex, apps)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Select ${a.role_title}`}
                      />
                    ) : renderCell(c.k, a, steps[a.id] || [], {
                      onSetRating,
                      onPickResume,
                      stageOpen: openStageId === a.id,
                      onToggleStage: () => setOpenStageId(openStageId === a.id ? null : a.id),
                      onCloseStage: () => setOpenStageId(null),
                      onPickStage: (k) => { setOpenStageId(null); onChangeStage(a.id, k) },
                    })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function renderCell(k, a, steps, h) {
  const { onSetRating, onPickResume, stageOpen, onToggleStage, onCloseStage, onPickStage } = h
  switch (k) {
    case 'star':
      return <Rating value={a.rating || 0} onChange={(v) => onSetRating(a.id, v)} />
    case 'role':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Logo co={a.company?.name} domain={a.company?.domain || domainFromUrl(a.jd_url)} size={28} />
          <div style={{ minWidth: 0, lineHeight: 1.25 }}>
            <div style={{ fontSize: 12.75, fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.role_title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.company?.name || '—'}</div>
          </div>
        </div>
      )
    case 'loc':      return <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{a.location_text || '—'}</span>
    case 'mode':     return <span style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{a.mode ? cap(a.mode) : '—'}</span>
    case 'status':
      return (
        <StageDropdown
          stage={a.stage}
          open={stageOpen}
          onToggle={onToggleStage}
          onClose={onCloseStage}
          onPick={onPickStage}
        />
      )
    case 'applied':  return <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{shortDate(a.applied_at)}</span>
    case 'salary':   return <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{formatSalary(a.salary_min, a.salary_max, a.salary_currency)}</span>
    case 'progress': return <IvProgress steps={steps} />
    case 'resume':
      return (
        <button className="resume-tag-btn" onClick={() => onPickResume?.(a.id)}>
          {a.resume?.name
            ? <span className="resume-tag">{a.resume.version || a.resume.name.slice(0, 12)}</span>
            : <span className="resume-tag empty">—</span>}
        </button>
      )
    case 'source':
      return <span className="src-link"><span className="who">{a.source_detail || (a.source ? cap(a.source.replace('_', ' ')) : '—')}</span></span>
    case 'last':     return <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{relTime(a.last_activity_at)}</span>
    case 'link':
      return a.jd_url ? (
        <a className="jd-link" href={a.jd_url} target="_blank" rel="noreferrer" title={a.jd_url} onClick={e => e.stopPropagation()}>
          <ExternalLink size={13} />
        </a>
      ) : null
    default: return null
  }
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : ''

// Floating bar that appears above the table when one or more rows are
// selected. Lets the user bulk-update status or delete in one shot.
function BulkBar({ count, stageMenuOpen, onToggleStageMenu, onCloseStageMenu, onPickStage, onDelete, onClear }) {
  return (
    <div className="bulk-bar">
      <span className="bulk-count">
        <strong>{count}</strong> selected
      </span>
      <button className="btn ghost tiny" onClick={onClear}>
        <X size={12} />Clear
      </button>
      <span style={{ flex: 1 }} />
      <div style={{ position: 'relative', zIndex: stageMenuOpen ? 60 : 'auto' }}>
        <button className="btn ghost tiny" onClick={onToggleStageMenu}>
          Set status <ChevronDown size={11} />
        </button>
        {stageMenuOpen && (
          <>
            <div onClick={onCloseStageMenu}
              style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'transparent' }} />
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 60,
              background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 180, padding: 4,
            }}>
              {STAGES.map(s => (
                <button key={s.k} className="status-menu-item" onClick={() => onPickStage(s.k)}>
                  <span style={{ background: s.color, width: 6, height: 6, borderRadius: '50%', display: 'inline-block', marginRight: 8 }} />
                  {s.n}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button className="btn ghost tiny" onClick={onDelete} style={{ color: 'var(--bad)' }}>
        <Trash2 size={12} />Delete
      </button>
    </div>
  )
}

function TrackerKanban({ apps, onOpen, onMove }) {
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const cols = STAGES.filter(s => ['new','applied','screen','iv','final','offer','accepted'].includes(s.k))
  return (
    <div className="kan-wrap">
      {cols.map(g => {
        const items = apps.filter(a => a.stage === g.k)
        return (
          <div key={g.k} className={`kan-col ${overCol === g.k ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setOverCol(g.k) }}
            onDragLeave={() => setOverCol(prev => prev === g.k ? null : prev)}
            onDrop={() => { if (dragId) onMove(dragId, g.k); setDragId(null); setOverCol(null) }}>
            <div className="kan-col-head">
              <span className="dot" style={{ background: g.color }} />
              <span className="name">{g.n}</span>
              <span className="n">{items.length}</span>
            </div>
            {items.map(a => (
              <div key={a.id}
                className={`kan-card ${dragId === a.id ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDragId(a.id)}
                onDragEnd={() => setDragId(null)}
                onClick={() => onOpen(a.id)}>
                <div className="row">
                  <Logo co={a.company?.name} domain={a.company?.domain || domainFromUrl(a.jd_url)} size={24} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="role">{a.role_title}</div>
                    <div className="co">{a.company?.name} · {a.location_text || '—'}</div>
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                  {formatSalary(a.salary_min, a.salary_max, a.salary_currency)}
                </div>
                <div className="foot">
                  <span>{a.source_detail || ''}</span>
                  <span>{relTime(a.last_activity_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function TrackerCards({ apps, onOpen }) {
  return (
    <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, overflowY: 'auto', flex: 1, alignContent: 'start' }}>
      {apps.map(a => {
        const idx = STAGES.findIndex(s => s.k === a.stage)
        return (
          <div key={a.id} className="card card-pad" style={{ cursor: 'pointer' }} onClick={() => onOpen(a.id)}>
            <div className="row" style={{ gap: 12, marginBottom: 10 }}>
              <Logo co={a.company?.name} domain={a.company?.domain || domainFromUrl(a.jd_url)} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.role_title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{a.company?.name} · {a.location_text || '—'}</div>
              </div>
              <StatusPill s={a.stage} />
            </div>
            <div className="row" style={{ gap: 6, marginTop: 8, marginBottom: 10 }}>
              {STAGES.slice(0, 5).map((s, j) => (
                <div key={s.k} style={{
                  flex: 1, height: 4, borderRadius: 2,
                  background: j <= idx && a.stage !== 'reject' ? s.color : 'var(--bg-2)',
                }} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ink-2)' }}>
              <span className="mono">{formatSalary(a.salary_min, a.salary_max, a.salary_currency)}</span>
              <span>{relTime(a.last_activity_at)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
