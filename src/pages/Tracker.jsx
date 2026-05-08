import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Download, Sparkles, Table, KanbanSquare, LayoutGrid, ChevronDown, GripVertical, ExternalLink, Bell } from 'lucide-react'
import AppBar from '../components/AppBar'
import Logo from '../components/Logo'
import StatusPill from '../components/StatusPill'
import Rating from '../components/Rating'
import IvProgress from '../components/IvProgress'
import AddJobModal from '../components/AddJobModal'
import { listApplications, updateApplication, setStage, listSteps } from '../lib/api'
import { STAGES, formatSalary } from '../lib/stages'
import { relTime, shortDate } from '../lib/time'
import { useUI } from '../hooks/useUI'
import toast from 'react-hot-toast'

const COLS = [
  { k: 'star',     label: '★',                  w: 92,  align: 'left' },
  { k: 'role',     label: 'Role / Company',     w: 260, align: 'left' },
  { k: 'loc',      label: 'Location',           w: 90,  align: 'left' },
  { k: 'mode',     label: 'Remote?',            w: 90,  align: 'left' },
  { k: 'status',   label: 'Status',             w: 112, align: 'left' },
  { k: 'applied',  label: 'Applied',            w: 90,  align: 'left' },
  { k: 'salary',   label: 'Salary range',       w: 130, align: 'left' },
  { k: 'progress', label: 'Interview progress', w: 220, align: 'left' },
  { k: 'resume',   label: 'Resume',             w: 100, align: 'left' },
  { k: 'source',   label: 'Source',             w: 150, align: 'left' },
  { k: 'last',     label: 'Last activity',      w: 100, align: 'right' },
  { k: 'link',     label: 'JD',                 w: 36,  align: 'center' },
]

const STOP_PROP = new Set(['star', 'source', 'link'])

export default function Tracker() {
  const [view, setView] = useState('table')
  const [density, setDensity] = useState('regular')
  const [apps, setApps] = useState([])
  const [steps, setSteps] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({})
  const [showAdd, setShowAdd] = useState(false)
  const [params, setParams] = useSearchParams()
  const { openDrawer } = useUI()

  const load = async () => {
    setLoading(true)
    try {
      const a = await listApplications()
      setApps(a)
      const stepsByApp = {}
      await Promise.all(a.map(async app => {
        try { stepsByApp[app.id] = await listSteps(app.id) } catch { stepsByApp[app.id] = [] }
      }))
      setSteps(stepsByApp)
    } catch (e) {
      toast.error('Could not load applications')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

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
    return out
  }, [apps, filter])

  const onSetRating = async (id, rating) => {
    setApps(prev => prev.map(a => a.id === id ? { ...a, rating } : a))
    try { await updateApplication(id, { rating }) }
    catch { toast.error('Failed to save rating'); load() }
  }

  const onCreated = (app) => {
    load()
    setTimeout(() => openDrawer(app.id), 200)
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
      <AppBar title="Tracker" crumbs={`tracker · ${view}`} right={
        <>
          <button className="btn ghost tiny" onClick={() => setShowAdd(true)}>
            <Plus size={13} />Add
          </button>
          <button className="btn ai tiny">
            <Sparkles size={13} />Ask AI
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
        <span className={`chip ${filter.stage ? 'on' : ''}`} onClick={() => {
          const s = prompt('Filter stage (applied/screen/iv/final/offer/reject/ghost) — empty to clear')
          if (s === null) return
          setFilter({ ...filter, stage: s.trim() || undefined })
        }}>
          Status{filter.stage ? `: ${filter.stage}` : ''} <ChevronDown size={11} />
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono muted" style={{ fontSize: 11 }}>{filtered.length} of {apps.length}</span>
        <div className="seg">
          <button className={density === 'compact' ? 'on' : ''} onClick={() => setDensity('compact')}>Compact</button>
          <button className={density === 'regular' ? 'on' : ''} onClick={() => setDensity('regular')}>Regular</button>
        </div>
        <button className="btn ghost tiny" onClick={onExport}><Download size={13} />Export</button>
        <button className="btn primary tiny" onClick={() => setShowAdd(true)}><Plus size={13} />Add</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1,2,3].map(i => <div key={i} className="skel" style={{ height: 48 }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyTracker onAdd={() => setShowAdd(true)} />
        ) : view === 'table' ? (
          <TrackerTable apps={filtered} steps={steps} density={density} onOpen={openDrawer} onSetRating={onSetRating} />
        ) : view === 'kanban' ? (
          <TrackerKanban apps={filtered} onOpen={openDrawer} onMove={async (id, stage) => {
            setApps(prev => prev.map(a => a.id === id ? { ...a, stage } : a))
            try { await setStage(id, stage); toast.success('Moved') }
            catch { toast.error('Move failed'); load() }
          }} />
        ) : (
          <TrackerCards apps={filtered} onOpen={openDrawer} />
        )}
      </div>

      {showAdd && <AddJobModal onClose={() => setShowAdd(false)} onCreated={onCreated} />}
    </>
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

function TrackerTable({ apps, steps, density, onOpen, onSetRating }) {
  const [order, setOrder] = useState(() => COLS.map(c => c.k))
  const [dragKey, setDragKey] = useState(null)
  const [overKey, setOverKey] = useState(null)
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
              {cols.map(c => (
                <th key={c.k} draggable
                  onDragStart={onDragStart(c.k)} onDragOver={onDragOver(c.k)} onDrop={onDrop(c.k)}
                  onDragEnd={() => { setDragKey(null); setOverKey(null) }}
                  className={`th-drag ${dragKey === c.k ? 'th-dragging' : ''} ${overKey === c.k && dragKey && dragKey !== c.k ? 'th-over' : ''}`}
                  style={{ width: c.w, textAlign: c.align }}>
                  <span className="th-inner">
                    <span className="th-grip"><GripVertical size={11} /></span>
                    <span>{c.label}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {apps.map(a => (
              <tr key={a.id} className={`s-${a.stage}`} onClick={() => onOpen(a.id)}>
                {cols.map(c => (
                  <td key={c.k}
                    style={{ padding: `${padY}px 10px`, textAlign: c.align }}
                    onClick={STOP_PROP.has(c.k) ? (e) => e.stopPropagation() : undefined}>
                    {renderCell(c.k, a, steps[a.id] || [], onSetRating)}
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

function renderCell(k, a, steps, onSetRating) {
  switch (k) {
    case 'star':
      return <Rating value={a.rating || 0} onChange={(v) => onSetRating(a.id, v)} />
    case 'role':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Logo co={a.company?.name} size={28} />
          <div style={{ minWidth: 0, lineHeight: 1.25 }}>
            <div style={{ fontSize: 12.75, fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.role_title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.company?.name || '—'}</div>
          </div>
        </div>
      )
    case 'loc':      return <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{a.location_text || '—'}</span>
    case 'mode':     return <span style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{a.mode ? cap(a.mode) : '—'}</span>
    case 'status':   return <StatusPill s={a.stage} />
    case 'applied':  return <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{shortDate(a.applied_at)}</span>
    case 'salary':   return <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{formatSalary(a.salary_min, a.salary_max, a.salary_currency)}</span>
    case 'progress': return <IvProgress steps={steps} />
    case 'resume':
      return a.resume?.name
        ? <span className="resume-tag">{a.resume.version || a.resume.name.slice(0, 12)}</span>
        : <span className="resume-tag empty">—</span>
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

function TrackerKanban({ apps, onOpen, onMove }) {
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const cols = STAGES.filter(s => ['applied','screen','iv','final','offer','reject'].includes(s.k))
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
                  <Logo co={a.company?.name} size={24} />
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
              <Logo co={a.company?.name} size={40} />
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
