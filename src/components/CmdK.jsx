import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Search as SearchIcon, Plus, Inbox as InboxIcon, FileText, Calendar as CalIcon, Layers, ArrowRight } from 'lucide-react'
import { listApplications, listEmails, listContacts } from '../lib/api'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../hooks/useUI'

const QUICK_ACTIONS = [
  { id: 'add',      label: 'Add a job from URL',  sub: 'Paste any Lever / Greenhouse link', Icon: Plus,        path: '/tracker?addjob=1' },
  { id: 'inbox',    label: 'Open inbox',          sub: 'See parsed emails',                  Icon: InboxIcon,   path: '/inbox' },
  { id: 'cal',      label: 'Open calendar',       sub: 'Week + month',                       Icon: CalIcon,     path: '/calendar' },
  { id: 'res',      label: 'Open resumes',        sub: 'Versions and ATS scoring',           Icon: FileText,    path: '/resumes' },
  { id: 'tracker',  label: 'Open tracker',        sub: 'All applications',                   Icon: Layers,      path: '/tracker' },
]

export default function CmdK({ onClose }) {
  const [q, setQ] = useState('')
  const [apps, setApps] = useState([])
  const [emails, setEmails] = useState([])
  const [contacts, setContacts] = useState([])
  const inputRef = useRef(null)
  const nav = useNavigate()
  const { openDrawer } = useUI()

  useEffect(() => {
    inputRef.current?.focus()
    Promise.all([listApplications(), listEmails(), listContacts()])
      .then(([a, e, c]) => { setApps(a); setEmails(e); setContacts(c) })
      .catch(() => {})
  }, [])

  const ql = q.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!ql) {
      return {
        apps: apps.slice(0, 5),
        actions: QUICK_ACTIONS,
        emails: [],
        contacts: [],
      }
    }
    const f = (s) => (s || '').toLowerCase().includes(ql)
    return {
      apps: apps.filter(a => f(a.role_title) || f(a.company?.name)).slice(0, 6),
      actions: QUICK_ACTIONS.filter(a => f(a.label) || f(a.sub)),
      emails: emails.filter(e => f(e.subject) || f(e.from_name) || f(e.from_email)).slice(0, 4),
      contacts: contacts.filter(c => f(c.name) || f(c.email)).slice(0, 4),
    }
  }, [ql, apps, emails, contacts])

  const goAction = (a) => {
    onClose()
    nav(a.path)
  }
  const goApp = (a) => {
    onClose()
    openDrawer(a.id)
  }

  return (
    <div className="cmd-scrim" onClick={onClose}>
      <div className="cmd-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-row">
          <div className="spark"><Sparkles size={13} /></div>
          <input ref={inputRef} className="cmd-input" placeholder="Ask anything, or type a command…"
            value={q} onChange={e => setQ(e.target.value)} />
          <span className="mono muted" style={{ fontSize: 10 }}>CONTEXT · WORKSPACE</span>
        </div>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {filtered.actions.length > 0 && (
            <div className="cmd-section">
              <div className="section-h">Quick actions</div>
              {filtered.actions.map(a => {
                const Icon = a.Icon
                return (
                  <div key={a.id} className="cmd-item" onClick={() => goAction(a)}>
                    <span className="ico"><Icon size={15} strokeWidth={1.6} /></span>
                    <span className="lbl">{a.label}<small>{a.sub}</small></span>
                    <ArrowRight size={13} color="var(--ink-3)" />
                  </div>
                )
              })}
            </div>
          )}

          {filtered.apps.length > 0 && (
            <div className="cmd-section">
              <div className="section-h">Applications</div>
              {filtered.apps.map(a => (
                <div key={a.id} className="cmd-item" onClick={() => goApp(a)}>
                  <span className="ico"><Layers size={15} strokeWidth={1.6} /></span>
                  <span className="lbl">{a.role_title}<small>{a.company?.name || '—'}</small></span>
                  <ArrowRight size={13} color="var(--ink-3)" />
                </div>
              ))}
            </div>
          )}

          {filtered.emails.length > 0 && (
            <div className="cmd-section">
              <div className="section-h">Emails</div>
              {filtered.emails.map(e => (
                <div key={e.id} className="cmd-item" onClick={() => { onClose(); nav('/inbox') }}>
                  <span className="ico"><InboxIcon size={15} strokeWidth={1.6} /></span>
                  <span className="lbl">{e.subject}<small>{e.from_name || e.from_email}</small></span>
                  <ArrowRight size={13} color="var(--ink-3)" />
                </div>
              ))}
            </div>
          )}

          {filtered.contacts.length > 0 && (
            <div className="cmd-section">
              <div className="section-h">Contacts</div>
              {filtered.contacts.map(c => (
                <div key={c.id} className="cmd-item" onClick={() => { onClose(); nav('/connections') }}>
                  <span className="ico"><SearchIcon size={15} strokeWidth={1.6} /></span>
                  <span className="lbl">{c.name}<small>{c.email}</small></span>
                  <ArrowRight size={13} color="var(--ink-3)" />
                </div>
              ))}
            </div>
          )}

          {ql && filtered.apps.length === 0 && filtered.actions.length === 0 && filtered.emails.length === 0 && filtered.contacts.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              No matches for "<b>{q}</b>"
            </div>
          )}
        </div>
        <div className="cmd-foot">
          <span><span className="kbd">↵</span>open</span>
          <span><span className="kbd">esc</span>close</span>
          <span style={{ flex: 1 }} />
          <span>Powered by Hired</span>
        </div>
      </div>
    </div>
  )
}
