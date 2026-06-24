import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Search as SearchIcon, Plus, Inbox as InboxIcon, FileText, Calendar as CalIcon, Layers, ArrowRight, X, Send, Loader2, Mail, User as UserIcon } from 'lucide-react'
import { listApplications, listEmails, listContacts } from '../lib/api'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../hooks/useUI'
import { useAuth } from '../hooks/useAuth'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import { trackUsage } from '../lib/ai'
import { askQuestion, fetchAskContext } from '../lib/agents/askAI'

const QUICK_ACTIONS = [
  { id: 'add',      label: 'Add a job from URL',  sub: 'Paste any Lever / Greenhouse link', Icon: Plus,        path: '/tracker?addjob=1' },
  { id: 'inbox',    label: 'Open inbox',          sub: 'See parsed emails',                  Icon: InboxIcon,   path: '/inbox' },
  { id: 'cal',      label: 'Open calendar',       sub: 'Week + month',                       Icon: CalIcon,     path: '/calendar' },
  { id: 'res',      label: 'Open resumes',        sub: 'Versions and ATS scoring',           Icon: FileText,    path: '/resumes' },
  { id: 'tracker',  label: 'Open tracker',        sub: 'All applications',                   Icon: Layers,      path: '/tracker' },
]

const SUGGESTIONS = [
  "How's my job search going?",
  'What tasks are due this week?',
  'Which applications need follow-up?',
  'Any interviews coming up?',
]

// Right-side sidebar (matches Drawer / EmailDrawer). Two tabs: Search (the
// existing workspace search) and Ask AI (a chat grounded in the user's job
// search data). The active tab is seeded from `initialTab`.
export default function CmdK({ onClose, initialTab = 'search' }) {
  const [tab, setTab] = useState(initialTab === 'ask' ? 'ask' : 'search')

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer cmd-drawer" role="dialog" aria-modal="true">
        <div className="drawer-head" style={{ padding: '14px 18px' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <div className="spark" style={{ width: 22, height: 22, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Sparkles size={12} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Workspace</span>
            <span style={{ flex: 1 }} />
            <button className="btn ghost icon" onClick={onClose} title="Close"><X size={14} /></button>
          </div>
        </div>
        <div className="drawer-tabs">
          <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>Search</button>
          <button className={`tab-accent ${tab === 'ask' ? 'on' : ''}`} onClick={() => setTab('ask')}>
            Ask AI
          </button>
        </div>
        {/* Both panes stay mounted (toggled via display) so search results and
            chat history survive tab switches; everything resets on close. */}
        <SearchPane active={tab === 'search'} onClose={onClose} />
        <AskPane active={tab === 'ask'} />
      </div>
    </>
  )
}

// ─── Search ──────────────────────────────────────────────────────────────────
function SearchPane({ active, onClose }) {
  const [q, setQ] = useState('')
  const [apps, setApps] = useState([])
  const [emails, setEmails] = useState([])
  const [contacts, setContacts] = useState([])
  const inputRef = useRef(null)
  const nav = useNavigate()
  const { openDrawer, openEmail } = useUI()

  useEffect(() => {
    Promise.all([listApplications(), listEmails(), listContacts()])
      .then(([a, e, c]) => { setApps(a); setEmails(e); setContacts(c) })
      .catch(() => {})
  }, [])
  useEffect(() => { if (active) inputRef.current?.focus() }, [active])

  const ql = q.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!ql) {
      return { apps: apps.slice(0, 5), actions: QUICK_ACTIONS, emails: [], contacts: [] }
    }
    const f = (s) => (s || '').toLowerCase().includes(ql)
    return {
      apps: apps.filter(a => f(a.role_title) || f(a.company?.name)).slice(0, 6),
      actions: QUICK_ACTIONS.filter(a => f(a.label) || f(a.sub)),
      emails: emails.filter(e => f(e.subject) || f(e.from_name) || f(e.from_email)).slice(0, 4),
      contacts: contacts.filter(c => f(c.name) || f(c.email)).slice(0, 4),
    }
  }, [ql, apps, emails, contacts])

  // openDrawer / openEmail already close the sidebar (one sidebar at a time);
  // nav targets need an explicit onClose.
  const goAction = (a) => { onClose(); nav(a.path) }
  const goContacts = () => { onClose(); nav('/connections') }

  const empty = ql && !filtered.apps.length && !filtered.actions.length && !filtered.emails.length && !filtered.contacts.length

  return (
    <div className="cmd-pane" style={{ display: active ? 'flex' : 'none' }}>
      <div className="cmd-input-row">
        <SearchIcon size={15} color="var(--ink-3)" />
        <input ref={inputRef} className="cmd-input" placeholder="Search apps, emails, contacts…"
          value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="cmd-results">
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
              <div key={a.id} className="cmd-item" onClick={() => openDrawer(a.id)}>
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
              <div key={e.id} className="cmd-item" onClick={() => openEmail(e.id)}>
                <span className="ico"><Mail size={15} strokeWidth={1.6} /></span>
                <span className="lbl">{e.subject || '(no subject)'}<small>{e.from_name || e.from_email}</small></span>
                <ArrowRight size={13} color="var(--ink-3)" />
              </div>
            ))}
          </div>
        )}

        {filtered.contacts.length > 0 && (
          <div className="cmd-section">
            <div className="section-h">Contacts</div>
            {filtered.contacts.map(c => (
              <div key={c.id} className="cmd-item" onClick={goContacts}>
                <span className="ico"><UserIcon size={15} strokeWidth={1.6} /></span>
                <span className="lbl">{c.name}<small>{c.email}</small></span>
                <ArrowRight size={13} color="var(--ink-3)" />
              </div>
            ))}
          </div>
        )}

        {empty && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            No matches for "<b>{q}</b>"
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Ask AI ──────────────────────────────────────────────────────────────────
function AskPane({ active }) {
  const { user } = useAuth()
  const { openUpgrade } = useUI()
  const { allowed, used, limit, refresh } = useLimit('ask_ai_per_day')

  const [messages, setMessages] = useState([]) // { role: 'user'|'assistant', content }
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const ctxRef = useRef(null)        // cached context summary string
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  const unlimited = limit < 0
  const remaining = unlimited ? Infinity : Math.max(0, limit - used)
  const outOfQuota = !unlimited && remaining <= 0

  useEffect(() => { if (active) inputRef.current?.focus() }, [active])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  const send = async (text) => {
    const q = (text ?? input).trim()
    if (!q || loading) return
    if (!guardLimit({ allowed, feature: 'ask_ai_per_day', openUpgrade })) return

    setInput('')
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(prev => [...prev, { role: 'user', content: q }])
    setLoading(true)
    try {
      // Fetch the job-search context once per chat session, then reuse it.
      if (ctxRef.current == null) {
        try { ctxRef.current = await fetchAskContext() } catch { ctxRef.current = '' }
      }
      const res = await askQuestion(q, ctxRef.current, history)
      setMessages(prev => [...prev, { role: 'assistant', content: res.answer }])
      if (user?.id && res?._usage) {
        await trackUsage(user.id, 'ask_ai_per_day', res._usage.model, res._usage.inputTokens, res._usage.outputTokens)
        refresh()
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry — I couldn't answer that just now. Please try again." }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cmd-pane" style={{ display: active ? 'flex' : 'none' }}>
      <div className="ask-disclaimer">AI can make mistakes. Verify important details.</div>
      <div className="ask-messages" ref={scrollRef}>
        {messages.length === 0 && !loading && (
          <div className="ask-empty">
            <div className="spark-lg"><Sparkles size={18} /></div>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 10 }}>Ask about your job search</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>
              I can see your applications, tasks, events, and emails. Try a question below.
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ask-bubble ${m.role}`}>
            {m.role === 'assistant' ? <MarkdownLite text={m.content} /> : m.content}
          </div>
        ))}
        {loading && (
          <div className="ask-bubble assistant typing">
            <span className="dot" /><span className="dot" /><span className="dot" />
          </div>
        )}
      </div>

      <div className="ask-input-wrap">
        {messages.length === 0 && !outOfQuota && (
          <div className="ask-chips">
            {SUGGESTIONS.map(s => (
              <button key={s} className="ask-chip" disabled={loading} onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        {outOfQuota ? (
          <div className="ask-limit">
            Daily limit reached —{' '}
            <button onClick={() => openUpgrade('ask_ai_per_day')}>See plans</button>
          </div>
        ) : (
          <>
            <div className="ask-input-row">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Ask about your job search…"
                disabled={loading}
              />
              <button className="btn ai icon" disabled={loading || !input.trim()} onClick={() => send()} title="Send">
                {loading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
              </button>
            </div>
            {!unlimited && (
              <div className="ask-quota">{remaining} question{remaining === 1 ? '' : 's'} remaining today</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Minimal markdown renderer (bold + bullet/numbered lists + paragraphs) ───
function renderInline(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part)
    return m ? <strong key={i}>{m[1]}</strong> : <span key={i}>{part}</span>
  })
}

function MarkdownLite({ text }) {
  const blocks = []
  let list = null
  String(text || '').split('\n').forEach(line => {
    const t = line.trim()
    const item = /^[-*]\s+(.*)/.exec(t) || /^\d+\.\s+(.*)/.exec(t)
    if (item) {
      if (!list) list = []
      list.push(item[1])
    } else {
      if (list) { blocks.push({ type: 'ul', items: list }); list = null }
      if (t) blocks.push({ type: 'p', content: t })
    }
  })
  if (list) blocks.push({ type: 'ul', items: list })

  return (
    <div className="md">
      {blocks.map((b, i) => b.type === 'p'
        ? <p key={i}>{renderInline(b.content)}</p>
        : <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>,
      )}
    </div>
  )
}
