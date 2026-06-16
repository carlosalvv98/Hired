import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Plus, FileText, X, Mail, ArrowRight, Settings2 } from 'lucide-react'
import AppBar from '../components/AppBar'
import Logo from '../components/Logo'
import { domainFromUrl } from '../lib/logos'
import StatusPill from '../components/StatusPill'
import TaskList from '../components/TaskList'
import NudgeConfigModal from '../components/NudgeConfigModal'
import { formatSalary } from '../lib/stages'
import AddJobModal, { JOB_URL_PLACEHOLDER } from '../components/AddJobModal'
import AddTaskModal from '../components/AddTaskModal'
import { listApplications, listEmails, listTasks, listNudges, dismissNudge, updateTask, listCalendar, listAllNudges, createNudges, setStage } from '../lib/api'
import { generateNudges } from '../lib/nudgeEngine'
import { resolveNudgePrefs } from '../lib/nudgeTypes'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { shortDate } from '../lib/time'
import { addDays, startOfDay, endOfDay, format, isBefore } from 'date-fns'
import toast from 'react-hot-toast'

export default function Dashboard() {
  const { user, profile } = useAuth()
  const { openDrawer, openEmail } = useUI()
  const { limit: nudgeLimit, loading: nudgeLimitLoading } = useLimit('nudges')
  const nav = useNavigate()
  const [apps, setApps] = useState([])
  const [emails, setEmails] = useState([])
  const [tasks, setTasks] = useState([])
  const [events, setEvents] = useState([])
  const [nudges, setNudges] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [showAddUrl, setShowAddUrl] = useState('')
  const [showAddTask, setShowAddTask] = useState(false)
  const [showNudgeConfig, setShowNudgeConfig] = useState(false)
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
  useEffect(() => { load() /* eslint-disable-next-line */ }, [user?.id])

  // Generate fresh nudges client-side once data + the tier limit have resolved
  // (paid tiers only). Runs after `load` so it has apps/emails/events on hand.
  useEffect(() => {
    if (loading || nudgeLimitLoading || nudgeLimit === 0 || !user?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const existing = await listAllNudges(user.id, addDays(new Date(), -30).toISOString())
        const remaining = nudgeLimit === -1 ? -1 : Math.max(0, nudgeLimit - nudges.length)
        const rows = generateNudges({
          userId: user.id, apps, emails, events,
          existing, prefs: resolveNudgePrefs(profile?.nudge_prefs), remaining,
        })
        if (!cancelled && rows.length) {
          await createNudges(rows)
          const fresh = await listNudges()
          if (!cancelled) setNudges(fresh)
        }
      } catch { /* non-fatal — nudges just won't refresh this load */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, nudgeLimitLoading, nudgeLimit, user?.id])

  const counts = useMemo(() => {
    const out = { new: 0, applied: 0, screen: 0, iv: 0, final: 0, offer: 0, reject: 0, ghost: 0 }
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

  // Breakdown of the "Active interviews" number (screen + interviewing + final)
  // so the subtext explains the count instead of showing a bare, confusing "0".
  const ivBreakdown = [
    counts.screen && `${counts.screen} screen`,
    counts.iv && `${counts.iv} interviewing`,
    counts.final && `${counts.final} final`,
  ].filter(Boolean).join(' · ')

  const KPIS = [
    { lbl: 'Total apps',         num: total, delta: total ? `${total} active` : 'no apps yet', tone: total ? 'good' : 'muted' },
    { lbl: 'Response rate',      num: total ? `${responseRate}%` : '—', delta: total ? `${counts.screen + counts.iv + counts.final + counts.offer} responded` : '', tone: 'good' },
    { lbl: 'Active interviews',  num: activeIv, delta: activeIv ? ivBreakdown : 'none yet', tone: 'muted' },
    { lbl: 'Offers',             num: offers, delta: offers ? '🎉' : 'none yet', tone: offers ? 'good' : 'muted' },
  ]

  // "New" = saved but not yet applied to. "Applied" therefore excludes them
  // (everything that has actually been sent out / progressed past 'new').
  const appliedCount = total - (counts.new || 0)
  const FUNNEL = [
    { stage: 'New', n: counts.new, k: 'new' },
    { stage: 'Applied', n: appliedCount, k: 'applied' },
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

  // Acting on a nudge runs its mapped action, then dismisses it (completed).
  const onNudgeAction = async (n) => {
    const act = n.cta_action_json || {}
    try {
      if (act.action === 'email' && act.email_id) {
        openEmail(act.email_id)
      } else if (act.action === 'stage' && n.application_id && act.to_stage) {
        await setStage(n.application_id, act.to_stage)
        openDrawer(n.application_id)
      } else if (act.action === 'summary') {
        nav('/tracker')
      } else if (n.application_id) {
        openDrawer(n.application_id)
      }
      setNudges(prev => prev.filter(x => x.id !== n.id))
      dismissNudge(n.id).catch(() => {})
    } catch { toast.error('Could not complete that action') }
  }

  return (
    <>
      <AppBar title={`Welcome${profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}`} crumbs="dashboard" />
      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: 18, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
            <Funnel data={FUNNEL} total={total} />
            <KpiGrid items={KPIS} />
            <ActiveAppsList loading={loading} apps={active} onOpen={openDrawer} onOpenTracker={() => nav('/tracker')} />
            <RecentEmails loading={loading} emails={recent}
              onOpenEmail={(id) => id && openEmail(id)}
              onOpenInbox={() => nav('/inbox')} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <QuickActions
              onAdd={(prefilledUrl = '') => { setShowAddUrl(prefilledUrl); setShowAdd(true) }}
              onTask={() => setShowAddTask(true)}
              onResume={() => nav('/resumes')}
            />
            <Nudges
              items={nudges}
              locked={nudgeLimit === 0}
              onAction={onNudgeAction}
              onConfigure={() => setShowNudgeConfig(true)}
              onDismiss={async (id) => {
                setNudges(prev => prev.filter(n => n.id !== id))
                try { await dismissNudge(id) } catch {}
              }} />
            <WeekAhead items={weekAhead} />
            <TaskList tasks={todayTasks.slice(0, 6)} onToggle={onToggleTask} overdue={overdue.length} onAdd={() => setShowAddTask(true)} />
          </div>
        </div>
      </div>
      {showAdd && <AddJobModal
        defaultUrl={showAddUrl}
        onClose={() => { setShowAdd(false); setShowAddUrl('') }}
        onCreated={(a) => { load(); openDrawer(a.id) }}
      />}
      {showAddTask && <AddTaskModal onClose={() => setShowAddTask(false)} onCreated={() => load()} />}
      {showNudgeConfig && (
        <NudgeConfigModal
          locked={nudgeLimit === 0}
          onClose={() => setShowNudgeConfig(false)}
          onSaved={() => load()}
        />
      )}
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

function ActiveAppsList({ loading, apps, onOpen, onOpenTracker }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13 }}>Active applications</h3>
        <span className="eyebrow muted">top {apps.length} in flight</span>
        <span style={{ flex: 1 }} />
        <button onClick={onOpenTracker} className="btn ghost tiny">Open tracker →</button>
      </div>
      {loading ? (
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} className="skel" style={{ height: 36 }} />)}
        </div>
      ) : apps.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12.5 }}>
          No active applications. <span style={{ color: 'var(--accent)' }}>Add one</span> from the rail →
        </div>
      ) : apps.map(a => {
        const salary = formatSalary(a.salary_min, a.salary_max, a.salary_currency)
        const meta = [a.company?.name, a.location_text, salary !== '—' ? salary : null].filter(Boolean).join(' · ')
        const desc = jobBlurb(a)
        const appliedAt = a.applied_at || a.created_at
        return (
          <div key={a.id} onClick={() => onOpen(a.id)}
            style={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1.1fr) minmax(0, 1fr) auto auto', gap: 14, alignItems: 'center', padding: '11px 18px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
            <Logo co={a.company?.name} domain={a.company?.domain || domainFromUrl(a.jd_url)} size={32} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.role_title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</div>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {desc}
            </div>
            <StatusPill s={a.stage} sm />
            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow muted" style={{ fontSize: 9 }}>Applied on</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{shortDate(appliedAt)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// A short one-line blurb for an application, pulled from the stored JD text /
// summaries. Empty string when we have nothing — the column just stays blank.
function jobBlurb(a) {
  const raw = (a.jd_text || a.jd_summary_role || a.jd_summary_company || '').trim()
  if (!raw) return ''
  const firstLine = raw.split('\n').map(s => s.trim()).filter(Boolean)[0] || ''
  return firstLine.length > 120 ? firstLine.slice(0, 120).trimEnd() + '…' : firstLine
}

function RecentEmails({ loading, emails, onOpenEmail, onOpenInbox }) {
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
      ) : emails.map((e, i) => {
        const snippet = (e.snippet || e.body_text || '').replace(/\s+/g, ' ').trim()
        return (
          <div key={e.id} onClick={() => onOpenEmail(e.id)}
            style={{ display: 'grid', gridTemplateColumns: '64px 150px minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: '11px 18px', borderBottom: i < emails.length - 1 ? '1px solid var(--line)' : 'none', cursor: 'pointer' }}>
            <div className="mono muted" style={{ fontSize: 10.5 }}>{shortDate(e.received_at)}</div>
            <div style={{ fontSize: 12.5, fontWeight: e.is_unread ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.from_name || e.from_email}
            </div>
            <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 12.5, color: e.is_unread ? 'var(--ink)' : 'var(--ink-2)' }}>{e.subject}</span>
              {snippet && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}> — {snippet}</span>}
            </div>
            <div style={{ textAlign: 'right' }}>{e.parse_json?.stage_signal && <StatusPill s={e.parse_json.stage_signal} sm />}</div>
          </div>
        )
      })}
    </div>
  )
}

function QuickActions({ onAdd, onTask, onResume }) {
  const [url, setUrl] = useState('')
  const onParse = () => {
    if (!url.trim()) return
    onAdd(url.trim())
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
      <form
        className="parse-input"
        onSubmit={e => { e.preventDefault(); onParse() }}
      >
        <input type="text" placeholder={JOB_URL_PLACEHOLDER}
          value={url} onChange={e => setUrl(e.target.value)} spellCheck={false} />
        <button className="btn ai" type="submit" disabled={!url.trim()}>
          <Sparkles size={12} /> Auto-fill
        </button>
      </form>
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

function Nudges({ items, locked, onAction, onConfigure, onDismiss }) {
  const headSpark = (
    <div style={{ width: 22, height: 22, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
      <Sparkles size={12} />
    </div>
  )
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        {headSpark}
        <h3 style={{ margin: 0, fontSize: 13 }}>AI nudges</h3>
        {!locked && items.length > 0 && <span className="mono muted" style={{ fontSize: 11 }}>{items.length} new</span>}
        <span style={{ flex: 1 }} />
        {!locked && (
          <button className="btn ghost tiny" onClick={onConfigure} title="Configure AI nudges"><Settings2 size={12} /></button>
        )}
      </div>

      {(locked || items.length === 0) ? (
        // Free tier OR no active nudges → "Configure AI Nudges" entry point.
        <button className="ai-card" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block' }} onClick={onConfigure}>
          <div className="nudge-h">Configure AI Nudges</div>
          <div className="nudge-p">
            {locked
              ? 'Proactive, one-click reminders to follow up, prep, and keep your pipeline moving. Available on Pro & Elite — tap to see what you’d get.'
              : 'No nudges right now. Choose which reminders Hired should surface for you.'}
          </div>
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(n => (
            <div key={n.id} className="ai-card" style={{ cursor: 'pointer' }} onClick={() => onAction(n)}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div style={{ width: 18, height: 18, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0, marginTop: 1 }}>
                  <Sparkles size={10} />
                </div>
                <div className="nudge-h" style={{ flex: 1 }}>{n.cta_label || 'Nudge'}</div>
                <button onClick={(e) => { e.stopPropagation(); onDismiss(n.id) }} style={{ color: 'var(--ink-3)' }} title="Dismiss"><X size={14} /></button>
              </div>
              <div className="nudge-p">{n.body_md}</div>
            </div>
          ))}
        </div>
      )}
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

