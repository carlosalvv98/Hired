import { useEffect, useState } from 'react'
import { X, Link as LinkIcon, MoreHorizontal, ArrowRight, Calendar as CalIcon, Sparkles, FileText, Download, Paperclip } from 'lucide-react'
import Logo from './Logo'
import StatusPill from './StatusPill'
import { STAGES, STAGE_LABEL, formatSalary } from '../lib/stages'
import { relTime, shortDate } from '../lib/time'
import {
  getApplication, listEvents, listSteps, upsertSteps, setStepStatus,
  setStage, listEmailsForApp, listAppContacts, updateApplication,
} from '../lib/api'
import toast from 'react-hot-toast'

const TABS = [
  { k: 'overview', n: 'Overview' },
  { k: 'timeline', n: 'Timeline' },
  { k: 'emails',   n: 'Emails' },
  { k: 'contacts', n: 'Contacts' },
  { k: 'notes',    n: 'Notes' },
]

export default function Drawer({ id, onClose }) {
  const [app, setApp] = useState(null)
  const [tab, setTab] = useState('overview')
  const [events, setEvents] = useState([])
  const [steps, setSteps] = useState([])
  const [emails, setEmails] = useState([])
  const [contacts, setContacts] = useState([])
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const load = async () => {
    try {
      const a = await getApplication(id)
      setApp(a)
      setNotes(a.notes_md || '')
      const [ev, st, em, co] = await Promise.all([
        listEvents(id), listSteps(id), listEmailsForApp(id), listAppContacts(id),
      ])
      setEvents(ev); setSteps(st); setEmails(em); setContacts(co)
    } catch (e) {
      toast.error('Could not load application')
      onClose()
    }
  }

  useEffect(() => { load() }, [id])

  if (!app) {
    return (
      <>
        <div className="drawer-scrim" onClick={onClose} />
        <div className="drawer">
          <div className="drawer-head">
            <div className="skel" style={{ height: 80 }} />
          </div>
        </div>
      </>
    )
  }

  const advance = async () => {
    const order = ['applied', 'screen', 'iv', 'final', 'offer']
    const idx = order.indexOf(app.stage)
    if (idx === -1 || idx === order.length - 1) return
    const next = order[idx + 1]
    try {
      const updated = await setStage(app.id, next)
      setApp(prev => ({ ...prev, ...updated }))
      toast.success(`Moved to ${STAGE_LABEL[next]}`)
      const ev = await listEvents(id)
      setEvents(ev)
    } catch (e) { toast.error('Could not update stage') }
  }

  const onChangeStage = async (newStage) => {
    try {
      const updated = await setStage(app.id, newStage)
      setApp(prev => ({ ...prev, ...updated }))
      toast.success(`Stage: ${STAGE_LABEL[newStage]}`)
      const ev = await listEvents(id)
      setEvents(ev)
    } catch { toast.error('Could not update stage') }
  }

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + `/?app=${app.id}`)
      toast.success('Link copied')
    } catch { toast.error('Copy failed') }
  }

  const toggleStep = async (step) => {
    try {
      const ns = step.status === 'done' ? 'pending' : 'done'
      await setStepStatus(step.id, ns)
      setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: ns } : s))
    } catch { toast.error('Could not update step') }
  }

  const addStep = async () => {
    const title = prompt('Step title? (e.g. "Recruiter screen")')
    if (!title) return
    const next = [...steps, { title, status: 'pending', learned_from_cohort: false }]
    try {
      const saved = await upsertSteps(app.id, next)
      setSteps(saved)
    } catch { toast.error('Could not add step') }
  }

  const saveNotes = async () => {
    if (savingNotes) return
    setSavingNotes(true)
    try {
      await updateApplication(app.id, { notes_md: notes })
      toast.success('Notes saved')
    } catch { toast.error('Save failed') }
    finally { setSavingNotes(false) }
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="row" style={{ marginBottom: 14 }}>
            <button className="btn ghost icon" onClick={onClose} title="Close"><X size={14} /></button>
            <span className="mono muted" style={{ fontSize: 10.5 }}>
              APP-{app.id.slice(0, 6).toUpperCase()} · {shortDate(app.created_at)}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn ghost tiny" onClick={onCopyLink}>
              <LinkIcon size={13} />Copy link
            </button>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <Logo co={app.company?.name} size={48} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.018em' }}>{app.role_title}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
                {app.company?.name} · {app.location_text || '—'} · <span className="mono">{formatSalary(app.salary_min, app.salary_max, app.salary_currency)}</span>
              </div>
            </div>
            <select value={app.stage} onChange={e => onChangeStage(e.target.value)}
              className="pill" style={{ border: 'none', cursor: 'pointer', padding: '4px 10px', background: 'transparent' }}>
              {STAGES.map(s => <option key={s.k} value={s.k}>{s.n}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
            <button className="btn primary tiny" onClick={advance} disabled={['offer', 'reject', 'ghost'].includes(app.stage)}>
              <ArrowRight size={12} />Move to next stage
            </button>
            <button className="btn ai tiny">
              <Sparkles size={13} />Prep me
            </button>
          </div>
        </div>

        <div className="drawer-tabs">
          {TABS.map(({ k, n }) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {n}{k === 'emails' && emails.length ? ` · ${emails.length}` : ''}
              {k === 'contacts' && contacts.length ? ` · ${contacts.length}` : ''}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Fact label="Location" value={app.location_text || '—'} />
                <Fact label="Mode" value={app.mode || '—'} />
                <Fact label="Salary" value={formatSalary(app.salary_min, app.salary_max, app.salary_currency)} mono />
                <Fact label="Applied" value={shortDate(app.applied_at)} mono />
                <Fact label="Source" value={app.source || '—'} />
                <Fact label="Last activity" value={relTime(app.last_activity_at)} />
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Interview steps</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {steps.map(s => (
                    <div key={s.id} className="card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button onClick={() => toggleStep(s)} style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: s.status === 'done' ? 'none' : '1.5px solid var(--line-2)',
                        background: s.status === 'done' ? 'var(--accent)' : '#fff',
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, flexShrink: 0,
                      }}>
                        {s.status === 'done' && '✓'}
                      </button>
                      <span style={{ flex: 1, fontSize: 13, textDecoration: s.status === 'done' ? 'line-through' : 'none', color: s.status === 'done' ? 'var(--ink-3)' : 'var(--ink)' }}>
                        {s.title}
                      </span>
                      {s.learned_from_cohort && <span className="tag indigo"><Sparkles size={9} />learned</span>}
                    </div>
                  ))}
                  <button className="btn ghost tiny" onClick={addStep}>+ Add step</button>
                </div>
              </div>
              {app.jd_url && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Job description</div>
                  <a className="src-link" href={app.jd_url} target="_blank" rel="noreferrer">
                    {app.jd_url}
                  </a>
                </div>
              )}
            </div>
          )}

          {tab === 'timeline' && (
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: 6, top: 18, bottom: 18, width: 1, background: 'var(--line)' }} />
              {events.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No activity yet.</div>}
              {events.map(ev => (
                <div key={ev.id} style={{ display: 'grid', gridTemplateColumns: '14px 90px 1fr', gap: 12, padding: '10px 0', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
                  <div style={{
                    width: 13, height: 13, borderRadius: '50%',
                    background: ev.actor === 'ai' ? 'linear-gradient(135deg, var(--accent), #a78bfa)' : '#fff',
                    border: '2px solid var(--ink)', marginTop: 3,
                  }} />
                  <div className="mono muted" style={{ fontSize: 10.5, paddingTop: 3 }}>{relTime(ev.at)}</div>
                  <div style={{ fontSize: 13 }}>
                    {renderEvent(ev)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'emails' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {emails.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No emails linked yet.</div>}
              {emails.map(e => (
                <div key={e.id} className="card card-pad" style={{ padding: 14 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{e.from_name || e.from_email}</span>
                    <span className="mono muted" style={{ fontSize: 10.5 }}>{relTime(e.received_at)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>{e.subject}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>
                    {(e.snippet || e.body_text || '').slice(0, 160)}…
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'contacts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {contacts.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No contacts linked yet.</div>}
              {contacts.map((c, i) => {
                const ct = c.contact
                if (!ct) return null
                const initials = (ct.name || '?').split(' ').map(s => s[0]).join('').slice(0, 2)
                return (
                  <div key={c.contact_id} className="card card-pad" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className={`av-grad-${i % 6}`} style={{
                      width: 36, height: 36, borderRadius: '50%', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 12,
                    }}>{initials}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5 }}>{ct.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {ct.role || 'Contact'}{ct.company?.name ? ` · ${ct.company.name}` : ''}
                      </div>
                    </div>
                    {ct.email && (
                      <a className="btn ghost tiny" href={`mailto:${ct.email}`}>
                        <Paperclip size={13} />
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'notes' && (
            <div className="card card-pad">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Notes about this application…"
                style={{
                  width: '100%', minHeight: 200, border: 'none', outline: 'none',
                  resize: 'vertical', fontSize: 13, lineHeight: 1.6,
                  fontFamily: 'var(--sans)', color: 'var(--ink-2)', background: 'transparent',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="btn primary tiny" onClick={saveNotes} disabled={savingNotes}>
                  {savingNotes ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Fact({ label, value, mono }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 4 }}>{label}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 13 }}>{value}</div>
    </div>
  )
}

function renderEvent(ev) {
  const p = ev.payload_json || {}
  switch (ev.kind) {
    case 'stage_change':
      if (p.initial) return <>Application created in <StatusPill s={p.to} /></>
      return <>Stage changed to <StatusPill s={p.to} />{ev.actor === 'ai' && <> · <span className="tag indigo">AI</span></>}</>
    case 'note':
      return p.text || 'Note added'
    case 'email':
      return <>Email · {p.subject || '—'}</>
    case 'task':
      return <>Task · {p.title || '—'}</>
    default:
      return ev.kind
  }
}
