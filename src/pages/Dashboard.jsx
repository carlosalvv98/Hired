import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Plus, FileText, X, Mail, ArrowRight, Check } from 'lucide-react'
import AppBar from '../components/AppBar'
import Logo from '../components/Logo'
import StatusPill from '../components/StatusPill'
import AddJobModal from '../components/AddJobModal'
import AddTaskModal from '../components/AddTaskModal'
import { listApplications, listEmails, listTasks, listNudges, dismissNudge, updateTask, listCalendar } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { relTime, shortDate, dayMonth } from '../lib/time'
import { addDays, startOfDay, endOfDay, format, isBefore } from 'date-fns'
import toast from 'react-hot-toast'

export default function Dashboard() {
  const { profile } = useAuth()
  const { openDrawer } = useUI()
  const nav = useNavigate()
  const [apps, setApps] = useState([])
  const [emails, setEmails] = useState([])
  const [tasks, setTasks] = useState([])
  const [events, setEvents] = useState([])
  const [nudges, setNudges] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [a, e, t, n, c] = await Promise.all([
        listApplications(),
        listEmails().catch(() => []),
        listTasks(),
        listNudges().catch(() => []),
        listCalendar({ from: new Date().toISOString(), to: addDays(new Date(), 14).toISOString() }).catch(() => []),
      ])
      setApps(a); setEmails(e); setTasks(t); setNudges(n); setEvents(c)
    } catch (err) {
      toast.error('Could not load dashboard')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const counts = useMemo(() => {
    const out = { applied: 0, screen: 0, iv: 0, final: 0, offer: 0, reject: 0, ghost: 0 }
    apps.forEach(a => out[a.stage] = (out[a.stage] || 0) + 1)
    return out
  }, [apps])

  const total = apps.length
  const responseRate = total ? Math.round(((counts.screen + counts.iv + counts.final + counts.offer + counts.reject) / total) * 100) : 0
  const activeIv = counts.screen + counts.iv + counts.final
  const offers = counts.offer
  const ghostedCount = counts.ghost
  const todayTasks = tasks.filter(t => !t.done)
  const overdue = tasks.filter(t => !t.done && t.due_at && isBefore(new Date(t.due_at), new Date()))

  const KPIS = [
    { lbl: 'Total apps',         num: total, delta: total ? `${total} active` : 'no apps yet', tone: total ? 'good' : 'muted' },
    { lbl: 'Response rate',      num: total ? `${responseRate}%` : '—', delta: total ? `${counts.screen + counts.iv + counts.final + counts.offer} responded` : '', tone: 'good' },
    { lbl: 'Active interviews',  num: activeIv, delta: counts.iv ? `${counts.iv} in interview` : '0', tone: 'muted' },
    { lbl: 'Offers',             num: offers, delta: offers ? '🎉' : 'none yet', tone: offers ? 'good' : 'muted' },
  ]

  const FUNNEL = [
    { stage: 'Applied', n: total, k: 'all' },
    { stage: 'Screen', n: counts.screen, k: 'screen' },
    { stage: 'Interview', n: counts.iv, k: 'iv' },
    { stage: 'Final', n: counts.final, k: 'final' },
    { stage: 'Offer', n: counts.offer, k: 'offer' },
    { stage: 'Reject', n: counts.reject, k: 'reject' },
    { stage: 'Ghosted', n: counts.ghost, k: 'ghost' },
  ]

  const active = apps
    .filter(a => ['screen', 'iv', 'final', 'offer'].includes(a.stage))
    .slice(0, 5)
  const recent = emails.slice(0, 5)

  // Build week-ahead from calendar events grouped by date
  const weekAhead = useMemo(() => {
    const byDay = {}
    events.forEach(e => {
      const d = format(new Date(e.starts_at), 'yyyy-MM-dd')
      if (!byDay[d]) byDay[d] = []
      byDay[d].push(e)
    })
    return Object.entries(byDay).slice(0, 5).map(([date, items]) => ({
      date,
      items,
    }))
  }, [events])

  const onToggleTask = async (t) => {
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x))
    try { await updateTask(t.id, { done: !t.done, done_at: t.done ? null : new Date().toISOString() }) }
    catch { toast.error('Could not update'); load() }
  }

  return (
    <>
      <AppBar title={`Welcome${profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}`} crumbs="dashboard" />
      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: 18, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
            <Funnel data={FUNNEL} total={total} />
            <KpiGrid items={KPIS} />
            <ActiveAppsList loading={loading} apps={active} onOpen={openDrawer} />
            <RecentEmails loading={loading} emails={recent}
              onOpenApp={(id) => id && openDrawer(id)}
              onOpenInbox={() => nav('/inbox')} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <QuickActions onAdd={() => setShowAdd(true)} onTask={() => setShowAddTask(true)} onResume={() => nav('/resumes')} />
            <Nudges items={nudges} onDismiss={async (id) => {
              setNudges(prev => prev.filter(n => n.id !== id))
              try { await dismissNudge(id) } catch {}
            }} />
            <WeekAhead items={weekAhead} />
            <TaskList tasks={todayTasks.slice(0, 6)} onToggle={onToggleTask} overdue={overdue.length} onAdd={() => setShowAddTask(true)} />
          </div>
        </div>
      </div>
      {showAdd && <AddJobModal onClose={() => setShowAdd(false)} onCreated={(a) => { load(); openDrawer(a.id) }} />}
      {showAddTask && <AddTaskModal onClose={() => setShowAddTask(false)} onCreated={() => load()} />}
    </>
  )
}

function Funnel({ data, total }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13 }}>Pipeline</h3>
        <span className="eyebrow" style={{ marginLeft: 'auto' }}>{total} apps</span>
      </div>
      <div className="funnel">
        {data.map((f, i) => {
          const pct = total ? Math.max(2, Math.round((f.n / total) * 100)) : 0
          return (
            <div key={i} className={`funnel-step ${f.k === 'screen' ? 'active' : ''}`}>
              <div className="stage">{f.stage}</div>
              <div className="n">{f.n}</div>
              <div className="bar"><div style={{ width: `${pct}%` }} /></div>
              <div className="delta muted">{total ? `${Math.round((f.n / total) * 100)}%` : '—'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KpiGrid({ items }) {
  return (
    <div className="kpi-grid">
      {items.map((k, i) => (
        <div className="kpi" key={i}>
          <div className="lbl">{k.lbl}</div>
          <div className="num">{k.num}</div>
          <div className={`delta ${k.tone}`}>{k.delta}</div>
        </div>
      ))}
    </div>
  )
}

function ActiveAppsList({ loading, apps, onOpen }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13 }}>Active applications</h3>
        <span className="eyebrow muted" style={{ marginLeft: 'auto' }}>top {apps.length} in flight</span>
      </div>
      {loading ? (
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} className="skel" style={{ height: 36 }} />)}
        </div>
      ) : apps.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12.5 }}>
          No active applications. <span style={{ color: 'var(--accent)' }}>Add one</span> from the rail →
        </div>
      ) : apps.map(a => (
        <div key={a.id} onClick={() => onOpen(a.id)}
          style={{ display: 'grid', gridTemplateColumns: '36px 1fr 110px 160px 70px', gap: 12, alignItems: 'center', padding: '11px 18px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
          <Logo co={a.company?.name} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{a.role_title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{a.company?.name} · {a.location_text || '—'}</div>
          </div>
          <StatusPill s={a.stage} />
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{a.source_detail || '—'}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'right' }}>{relTime(a.last_activity_at)}</div>
        </div>
      ))}
    </div>
  )
}

function RecentEmails({ loading, emails, onOpenApp, onOpenInbox }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13 }}>Recent emails</h3>
        <span style={{ flex: 1 }} />
        <button onClick={onOpenInbox} className="btn ghost tiny">Open inbox →</button>
      </div>
      {loading ? (
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} className="skel" style={{ height: 28 }} />)}
        </div>
      ) : emails.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12.5 }}>
          No emails yet. Forward to your Hired address to start parsing.
        </div>
      ) : emails.map((e, i) => (
        <div key={e.id} onClick={() => e.linked_application_id && onOpenApp(e.linked_application_id)}
          style={{ display: 'grid', gridTemplateColumns: '180px 1fr 110px 50px', gap: 12, alignItems: 'center', padding: '11px 18px', borderBottom: i < emails.length - 1 ? '1px solid var(--line)' : 'none', cursor: e.linked_application_id ? 'pointer' : 'default' }}>
          <div style={{ fontSize: 12.5, fontWeight: e.is_unread ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.from_name || e.from_email}
          </div>
          <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: e.is_unread ? 'var(--ink)' : 'var(--ink-2)' }}>{e.subject}</div>
          <div>{e.parse_json?.stage_signal && <StatusPill s={e.parse_json.stage_signal} />}</div>
          <div className="mono muted" style={{ fontSize: 10.5, textAlign: 'right' }}>{relTime(e.received_at)}</div>
        </div>
      ))}
    </div>
  )
}

function QuickActions({ onAdd, onTask, onResume }) {
  const [url, setUrl] = useState('')
  const [chips, setChips] = useState(null)
  const [busy, setBusy] = useState(false)
  const onParse = async () => {
    if (!url) return
    setBusy(true)
    setChips({ company: '...', role: '...', salary: '...', mode: '...' })
    setTimeout(() => {
      setBusy(false)
      onAdd()
    }, 300)
  }
  return (
    <div className="card card-pad spotlight">
      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
        <Sparkles size={14} color="var(--accent)" />
        <h3 style={{ margin: 0, fontSize: 13.5 }}>Add a job in 1 click</h3>
      </div>
      <div className="eyebrow" style={{ fontSize: 10, color: 'var(--accent-ink)', opacity: 0.7, marginBottom: 6 }}>
        Paste link · AI fills the rest
      </div>
      <div className="parse-input">
        <input type="text" placeholder="https://jobs.lever.co/anthropic/forward-deployed-eng"
          value={url} onChange={e => setUrl(e.target.value)} spellCheck={false} />
        <button className="btn ai" onClick={onParse} disabled={!url || busy}>
          <Sparkles size={12} /> Parse
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--accent-soft-2)' }}>
        <button className="btn ghost" style={{ justifyContent: 'flex-start', padding: '9px 12px', background: '#fff' }} onClick={onResume}>
          <FileText size={13} />New resume
        </button>
        <button className="btn ghost" style={{ justifyContent: 'flex-start', padding: '9px 12px', background: '#fff' }} onClick={onTask}>
          <Plus size={13} />New task
        </button>
      </div>
    </div>
  )
}

function Nudges({ items, onDismiss }) {
  if (!items.length) return null
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div style={{ width: 22, height: 22, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <Sparkles size={12} />
        </div>
        <h3 style={{ margin: 0, fontSize: 13 }}>AI nudges</h3>
        <span className="mono muted" style={{ fontSize: 11 }}>{items.length} new</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(n => (
          <div key={n.id} className="ai-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
              <div style={{ width: 18, height: 18, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0, marginTop: 1 }}>
                <Sparkles size={10} />
              </div>
              <div className="nudge-h" style={{ flex: 1 }}>{n.cta_label || 'Nudge'}</div>
              <button onClick={() => onDismiss(n.id)} style={{ color: 'var(--ink-3)' }}><X size={14} /></button>
            </div>
            <div className="nudge-p">{n.body_md}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WeekAhead({ items }) {
  if (!items.length) return (
    <div className="card card-pad">
      <h3>Week ahead</h3>
      <div className="muted" style={{ fontSize: 12 }}>Nothing scheduled.</div>
    </div>
  )
  return (
    <div className="card card-pad">
      <h3>Week ahead <span className="count">{items.reduce((n, d) => n + d.items.length, 0)} events</span></h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
        {items.map((d, i) => {
          const dateObj = new Date(d.date)
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 10 }}>
              <div>
                <div className="eyebrow" style={{ fontSize: 9.5 }}>{format(dateObj, 'EEE')}</div>
                <div className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{format(dateObj, 'd')}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {d.items.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--line)' }}>
                    <span className={`dot ${e.application?.stage || 'iv'}`} />
                    <span style={{ fontSize: 11.5, fontWeight: 500, flex: 1 }}>{e.title}</span>
                    <span className="mono muted" style={{ fontSize: 10.5 }}>{format(new Date(e.starts_at), 'HH:mm')}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TaskList({ tasks, overdue, onToggle, onAdd }) {
  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Today's tasks <span className="count">{tasks.length}{overdue ? ` · ${overdue} overdue` : ''}</span></h3>
        <span style={{ flex: 1 }} />
        <button className="btn ghost tiny" onClick={onAdd}><Plus size={11} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 10 }}>
        {tasks.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No tasks. Quiet day. ✨</div>}
        {tasks.map((t, i) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: i < tasks.length - 1 ? '1px dashed var(--line)' : 'none', opacity: t.done ? 0.55 : 1 }}>
            <button onClick={() => onToggle(t)} style={{
              width: 16, height: 16, borderRadius: 4,
              border: t.done ? 'none' : '1.5px solid var(--line-2)',
              background: t.done ? 'var(--ink)' : '#fff',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>{t.done && <Check size={11} />}</button>
            <span style={{ flex: 1, fontSize: 12.5, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--ink-3)' : 'var(--ink)' }}>{t.title}</span>
            {t.due_at && <span className="mono muted" style={{ fontSize: 10.5 }}>{shortDate(t.due_at)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
