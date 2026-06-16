import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import TaskList from '../components/TaskList'
import AddEventModal from '../components/AddEventModal'
import AddTaskModal from '../components/AddTaskModal'
import {
  listCalendar, deleteCalendarEvent, listApplications, listStageEvents,
  listTasks, updateTask,
} from '../lib/api'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay,
  addDays, addMonths, subMonths, format, isSameMonth, isToday, isBefore,
} from 'date-fns'
import { useUI } from '../hooks/useUI'
import { confirmToast } from '../lib/confirmToast'
import toast from 'react-hot-toast'

// Short stage label used in the compact calendar activity line
// ("{label} · {company}") so long role titles don't overflow the cell.
const STAGE_VERB = {
  new: 'Saved', applied: 'Applied', screen: 'Screening',
  iv: 'Interview', final: 'Final round', offer: 'Offer',
  accepted: 'Accepted', reject: 'Rejected', ghost: 'Ghosted',
  closed: 'Closed',
}

// Compact line for a calendar cell: stage + company (falls back to role).
function activityLabel(a) {
  const verb = STAGE_VERB[a.stage] || 'Update'
  return `${verb} · ${a.company?.name || a.role_title}`
}

// Fuller text for the hover tooltip, where there's room for the role.
function activityTitle(a) {
  const verb = STAGE_VERB[a.stage] || 'Update'
  const co = a.company?.name ? ` at ${a.company.name}` : ''
  return `${verb} — ${a.role_title}${co}`
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState(new Date())
  const [events, setEvents] = useState([])
  const [apps, setApps] = useState([])
  const [stageEvents, setStageEvents] = useState([])
  const [tasks, setTasks] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)
  const [defaultDate, setDefaultDate] = useState(null)
  const { openDrawer } = useUI()

  const range = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })
    const days = []
    let d = start
    while (d <= end) { days.push(d); d = addDays(d, 1) }
    return { start, end, days }
  }, [cursor])

  const load = async () => {
    try {
      const e = await listCalendar({ from: range.start.toISOString(), to: range.end.toISOString() })
      setEvents(e)
    } catch { toast.error('Could not load calendar') }
  }
  useEffect(() => { load() }, [cursor])

  // Analytics data (apps + stage events + tasks) is independent of which month
  // is in view, so it loads once.
  const loadAnalytics = async () => {
    try {
      const since = startOfDay(addDays(new Date(), -29)).toISOString()
      const [a, se, t] = await Promise.all([
        listApplications(),
        listStageEvents(since).catch(() => []),
        listTasks(),
      ])
      setApps(a); setStageEvents(se); setTasks(t)
    } catch { /* non-fatal — chart/pills just stay empty */ }
  }
  useEffect(() => { loadAnalytics() }, [])

  // Applications in the pipeline, grouped by their most recent activity day —
  // drives the per-cell pill. We anchor on last_activity_at (the latest stage
  // move) so the cell reflects the most recent step, not just the apply date.
  const appliedByDay = useMemo(() => {
    const map = {}
    apps.forEach(a => {
      if (!a.applied_at) return
      const day = a.last_activity_at || a.applied_at
      const k = format(new Date(day), 'yyyy-MM-dd')
      if (!map[k]) map[k] = []
      map[k].push(a)
    })
    return map
  }, [apps])

  const eventsByDay = useMemo(() => {
    const map = {}
    events.forEach(e => {
      const k = format(new Date(e.starts_at), 'yyyy-MM-dd')
      if (!map[k]) map[k] = []
      map[k].push(e)
    })
    return map
  }, [events])

  const onCellClick = (d) => {
    setDefaultDate(d.toISOString())
    setShowAdd(true)
  }

  const onDeleteEvent = async (id) => {
    const ok = await confirmToast('Delete this event?', { confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    try {
      await deleteCalendarEvent(id)
      setEvents(prev => prev.filter(e => e.id !== id))
      toast.success('Deleted')
    } catch { toast.error('Delete failed') }
  }

  const onToggleTask = async (t) => {
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x))
    try { await updateTask(t.id, { done: !t.done, done_at: t.done ? null : new Date().toISOString() }) }
    catch { toast.error('Could not update'); loadAnalytics() }
  }

  const openTasks = tasks.filter(t => !t.done)
  const overdue = tasks.filter(t => !t.done && t.due_at && isBefore(new Date(t.due_at), new Date()))

  return (
    <>
      <AppBar title="Calendar" crumbs="month" />
      <PageActions
        left={
          <h2 className="page-month-h">{format(cursor, 'MMMM yyyy')}</h2>
        }
        right={
          <>
            <button className="btn ghost tiny" onClick={() => setCursor(new Date())}>Today</button>
            <button className="btn ghost icon" onClick={() => setCursor(c => subMonths(c, 1))}><ChevronLeft size={13} /></button>
            <button className="btn ghost icon" onClick={() => setCursor(c => addMonths(c, 1))}><ChevronRight size={13} /></button>
            <button className="btn primary tiny" onClick={() => { setDefaultDate(null); setShowAdd(true) }}><Plus size={13} />Event</button>
          </>
        } />
      <div className="content tight">
        <div className="cal-grid">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} className="cal-head">{d}</div>
          ))}
          {range.days.map(d => {
            const k = format(d, 'yyyy-MM-dd')
            const ev = eventsByDay[k] || []
            const applied = appliedByDay[k] || []
            return (
              <div key={k}
                className={`cal-cell ${!isSameMonth(d, cursor) ? 'outside' : ''} ${isToday(d) ? 'today' : ''}`}
                onClick={(e) => { if (e.target === e.currentTarget) onCellClick(d) }}>
                <div className="num">{format(d, 'd')}</div>
                {applied.length > 0 && (
                  <div className="cal-event cal-applied"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (applied.length === 1 && applied[0].id) openDrawer(applied[0].id)
                    }}
                    title={applied.map(activityTitle).join(', ')}>
                    ✓ {applied.length === 1
                      ? activityLabel(applied[0])
                      : `${applied.length} updates`}
                  </div>
                )}
                {ev.map(x => (
                  <div key={x.id} className={`cal-event pill ${x.application?.stage || 'iv'}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (x.application?.id) openDrawer(x.application.id)
                    }}
                    onContextMenu={(e) => { e.preventDefault(); onDeleteEvent(x.id) }}
                    title={`${x.title} — right-click to delete`}>
                    {format(new Date(x.starts_at), 'HH:mm')} · {x.title}
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 18, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <div className="card card-pad" style={{ flex: '2 1 460px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Activity <span className="count">last 30 days</span></h3>
            </div>
            <ApplicationsChart apps={apps} events={stageEvents} />
          </div>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <TaskList
              tasks={openTasks.slice(0, 8)}
              overdue={overdue.length}
              onToggle={onToggleTask}
              onAdd={() => setShowAddTask(true)}
            />
          </div>
        </div>
      </div>
      {showAdd && <AddEventModal onClose={() => setShowAdd(false)} onCreated={() => load()} defaultDate={defaultDate} />}
      {showAddTask && <AddTaskModal onClose={() => setShowAddTask(false)} onCreated={() => loadAnalytics()} />}
    </>
  )
}

// ── 30-day activity chart ─────────────────────────────────────────────────
// Colors mirror the --stage-* tokens used by the pills/dots across the app.
const SERIES = [
  { key: 'news',       label: 'New',        color: '#64748b' }, // --stage-new
  { key: 'applied',    label: 'Applied',    color: '#3b82f6' }, // --stage-applied
  { key: 'interviews', label: 'Interviews', color: '#f59e0b' }, // --stage-iv
  { key: 'offers',     label: 'Offers',     color: '#16a34a' }, // --stage-offer
]

// Stage transitions we treat as "an interview happened".
const INTERVIEW_STAGES = ['screen', 'iv', 'final']

function ApplicationsChart({ apps, events }) {
  const wrapRef = useRef(null)
  const [w, setW] = useState(700)

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(entries => {
      const cw = entries[0]?.contentRect?.width
      if (cw) setW(cw)
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const days = useMemo(() => {
    const today = startOfDay(new Date())
    return Array.from({ length: 30 }, (_, i) => addDays(today, i - 29))
  }, [])

  const [hoverIdx, setHoverIdx] = useState(null)
  const [hidden, setHidden] = useState(() => new Set())
  const toggle = (key) => setHidden(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  const visible = SERIES.filter(s => !hidden.has(s.key))

  const data = useMemo(() => {
    const news = {}, applied = {}, interviews = {}, offers = {}
    const bump = (obj, dt) => { const k = format(new Date(dt), 'yyyy-MM-dd'); obj[k] = (obj[k] || 0) + 1 }
    apps.forEach(a => {
      if (a.created_at) bump(news, a.created_at)
      if (a.applied_at) bump(applied, a.applied_at)
    })
    // Dedupe per application per day, so toggling a job in and out of a stage
    // (or being created directly into one) counts as a single interview/offer
    // for that day rather than one per stage transition.
    const seenIv = new Set(), seenOffer = new Set()
    events.forEach(e => {
      const to = e.payload_json?.to
      const day = format(new Date(e.at), 'yyyy-MM-dd')
      const key = `${e.application_id}|${day}`
      if (to === 'offer') {
        if (seenOffer.has(key)) return
        seenOffer.add(key); bump(offers, e.at)
      } else if (INTERVIEW_STAGES.includes(to)) {
        if (seenIv.has(key)) return
        seenIv.add(key); bump(interviews, e.at)
      }
    })
    return days.map(d => {
      const k = format(d, 'yyyy-MM-dd')
      return { d, news: news[k] || 0, applied: applied[k] || 0, interviews: interviews[k] || 0, offers: offers[k] || 0 }
    })
  }, [apps, events, days])

  // Scale to the currently-visible series so toggling rescales the chart.
  const maxY = Math.max(1, ...data.flatMap(p => visible.map(s => p[s.key])))
  const H = 220, padL = 26, padR = 14, padT = 12, padB = 26
  const plotW = Math.max(1, w - padL - padR)
  const plotH = H - padT - padB
  const x = (i) => padL + (i / (days.length - 1)) * plotW
  const y = (v) => padT + plotH - (v / maxY) * plotH

  const step = Math.max(1, Math.ceil(maxY / 4))
  const yTicks = []
  for (let v = 0; v <= maxY; v += step) yTicks.push(v)
  if (yTicks[yTicks.length - 1] !== maxY) yTicks.push(maxY)

  const xLabelIdx = [0, 5, 10, 15, 20, 25, 29]
  const hasData = data.some(p => p.news || p.applied || p.interviews || p.offers)

  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {SERIES.map(s => {
          const off = hidden.has(s.key)
          return (
            <button key={s.key} onClick={() => toggle(s.key)}
              title={off ? `Show ${s.label}` : `Hide ${s.label}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5,
                padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                border: '1px solid var(--line)', background: off ? 'transparent' : 'var(--bg)',
                color: off ? 'var(--ink-3)' : 'var(--ink-2)', opacity: off ? 0.55 : 1,
              }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: off ? 'var(--ink-3)' : s.color }} />
              {s.label}
            </button>
          )
        })}
      </div>
      <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
        <svg width={w} height={H} style={{ display: 'block' }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const mx = e.clientX - rect.left
            let i = Math.round(((mx - padL) / plotW) * (days.length - 1))
            i = Math.max(0, Math.min(days.length - 1, i))
            setHoverIdx(i)
          }}
          onMouseLeave={() => setHoverIdx(null)}>
          {/* horizontal gridlines + y labels */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" strokeDasharray={v === 0 ? '0' : '3 3'} />
              <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--ink-3)" fontFamily="var(--mono)">{v}</text>
            </g>
          ))}
          {/* x labels */}
          {xLabelIdx.map(i => (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--ink-3)" fontFamily="var(--mono)">
              {format(days[i], 'M/d')}
            </text>
          ))}
          {/* hover guide */}
          {hoverIdx != null && (
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padT} y2={padT + plotH} stroke="var(--line-2)" strokeWidth="1" />
          )}
          {/* series (only the toggled-on ones) */}
          {visible.map(s => (
            <g key={s.key}>
              <polyline
                fill="none" stroke={s.color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round"
                points={data.map((p, i) => `${x(i)},${y(p[s.key])}`).join(' ')}
              />
              {data.map((p, i) => p[s.key] > 0 && (
                <circle key={i} cx={x(i)} cy={y(p[s.key])} r={hoverIdx === i ? 3.5 : 2.5} fill={s.color} />
              ))}
            </g>
          ))}
        </svg>

        {/* hover callout — sits to the right of the cursor (flips left near the
            edge) so it never covers the point you're hovering. */}
        {hoverIdx != null && (() => {
          const tipW = 132
          const placeLeft = x(hoverIdx) + 14 + tipW > w
          const style = placeLeft
            ? { right: w - (x(hoverIdx) - 14) }
            : { left: x(hoverIdx) + 14 }
          return (
            <div style={{
              position: 'absolute', top: 4, pointerEvents: 'none', ...style,
              background: '#fff', color: 'var(--ink)', borderRadius: 8, padding: '7px 9px',
              fontSize: 11, lineHeight: 1.5, border: '1px solid var(--line)',
              boxShadow: '0 6px 18px rgba(0,0,0,0.12)', width: tipW, zIndex: 2,
            }}>
              <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 3 }}>{format(days[hoverIdx], 'EEE, MMM d')}</div>
              {visible.map(s => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, color: 'var(--ink-2)' }}>{s.label}</span>
                  <span style={{ fontWeight: 700 }}>{data[hoverIdx][s.key]}</span>
                </div>
              ))}
            </div>
          )
        })()}
        {!hasData && (
          <div className="muted" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, pointerEvents: 'none' }}>
            No activity in the last 30 days yet.
          </div>
        )}
      </div>
    </div>
  )
}
