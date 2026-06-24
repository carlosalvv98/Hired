import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Inbox as InboxIcon, Flag, Star, Archive, Settings as SettingsIcon, Check, Edit2, Link as LinkIcon, MoreHorizontal, ArrowRight, PenSquare, FileText, Trash2 } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import Logo from '../components/Logo'
import StatusPill from '../components/StatusPill'
import EmailReplies from '../components/EmailReplies'
import { EmailActions, EmailAttachments } from '../components/EmailActions'
import { listEmails, updateEmail, groupThreads, listThread, cleanSubject, countDrafts, deleteEmail, getEmailByMessageId } from '../lib/api'
import { countSentEmails } from '../lib/agents/styleAnalyzer'
import { relTime } from '../lib/time'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { STAGE_LABEL } from '../lib/stages'
import toast from 'react-hot-toast'

const FOLDERS = [
  { k: 'inbox',    n: 'All inbox',       Icon: InboxIcon },
  { k: 'parsed',   n: 'Auto-parsed',     Icon: Sparkles, accent: true },
  { k: 'unlinked', n: 'Needs review',    Icon: Flag, warn: true },
  { k: 'starred',  n: 'Starred',         Icon: Star },
  { k: 'draft',    n: 'Drafts',          Icon: FileText },
  { k: 'archive',  n: 'Archive',         Icon: Archive },
]

export default function Inbox() {
  const { profile, user } = useAuth()
  const { openDrawer, openCompose } = useUI()
  const [folder, setFolder] = useState('inbox')
  const [emails, setEmails] = useState([])
  const [selId, setSelId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [feed, setFeed] = useState('parsed')
  const [draftCount, setDraftCount] = useState(0)
  // When the selected row is a multi-message thread, the full conversation
  // (inbound + sent, oldest first) lives here and the reading pane switches to
  // the stacked conversation view.
  const [activeThreadId, setActiveThreadId] = useState(null)
  const [threadEmails, setThreadEmails] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())

  const load = async () => {
    setLoading(true)
    setActiveThreadId(null)
    setThreadEmails(null)
    try {
      const e = await listEmails({ folder })
      setEmails(e)
      if (e.length && !selId) setSelId(e[0].id)
    } catch (err) {
      toast.error('Could not load emails')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [folder])

  const loadDraftCount = () => countDrafts().then(setDraftCount).catch(() => {})
  useEffect(() => { loadDraftCount() }, [])

  // One-time nudge (Pro/Elite, no style learned yet): once the user has sent
  // enough emails, suggest learning their writing style. localStorage-gated so
  // it never repeats. Pills already drive discovery — this is just a hint.
  useEffect(() => {
    if (!user?.id) return
    const plan = user.plan
    if (plan !== 'pro' && plan !== 'elite') return
    if (user.writing_style) return
    let shown = false
    try { shown = !!localStorage.getItem('style_nudge_shown') } catch { /* ignore */ }
    if (shown) return
    countSentEmails(user.id).then(c => {
      if (c < 5) return
      try { localStorage.setItem('style_nudge_shown', '1') } catch { /* ignore */ }
      toast("✨ You've sent enough emails for the AI to learn your writing style. Try “Learn My Style” next time you draft a reply!", { duration: 6000 })
    }).catch(() => {})
  }, [user?.id, user?.plan, user?.writing_style])

  // Refresh the list after the global composer reports a successful send.
  useEffect(() => {
    const onSent = () => { load(); loadDraftCount() }
    const onDrafts = () => { loadDraftCount(); if (folder === 'draft') load() }
    window.addEventListener('hired:email-sent', onSent)
    window.addEventListener('hired:drafts-changed', onDrafts)
    return () => {
      window.removeEventListener('hired:email-sent', onSent)
      window.removeEventListener('hired:drafts-changed', onDrafts)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder])

  // Drafts are shown ungrouped; everything else respects the parsed-feed toggle.
  const filtered = useMemo(() => {
    if (folder === 'draft') return emails
    if (folder === 'inbox' && feed === 'parsed') return emails.filter(e => e.parse_status === 'parsed' || e.parse_status === 'needs_review')
    return emails
  }, [emails, feed, folder])

  // Collapse conversations into one representative row each (newest email).
  const grouped = useMemo(
    () => (folder === 'draft' ? filtered : groupThreads(filtered)),
    [filtered, folder],
  )

  // Load the full conversation when a threaded row is opened.
  useEffect(() => {
    if (!activeThreadId) return
    let alive = true
    listThread(activeThreadId).then(list => {
      if (!alive) return
      setThreadEmails(list)
      const exp = new Set()
      list.forEach((em, i) => { if (i === list.length - 1 || em.is_unread) exp.add(em.id) })
      setExpanded(exp)
      const unread = list.filter(em => em.is_unread)
      if (unread.length) {
        unread.forEach(em => updateEmail(em.id, { is_unread: false }).catch(() => {}))
        setEmails(prev => prev.map(x => x.thread_id === activeThreadId ? { ...x, is_unread: false } : x))
      }
    }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId])

  const sel = emails.find(e => e.id === selId) || grouped[0]
  const isThreadView = !!threadEmails && threadEmails.length > 1
  const HIRED_EMAIL = profile?.forwarding_address || `hired-${profile?.handle || 'me'}@hired.app`

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(HIRED_EMAIL)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { toast.error('Copy failed') }
  }

  // Open a list row. Threaded rows load the conversation; single rows mark read.
  const selectRow = (row) => {
    setSelId(row.id)
    if (row.threadCount > 1 && row.thread_id) {
      setActiveThreadId(row.thread_id)
    } else {
      setActiveThreadId(null)
      setThreadEmails(null)
      if (row.is_unread) {
        updateEmail(row.id, { is_unread: false }).catch(() => {})
        setEmails(prev => prev.map(x => x.id === row.id ? { ...x, is_unread: false } : x))
      }
    }
  }

  const toggleExpand = (id) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Reopen a draft in the composer with everything pre-filled. Reply drafts
  // reload their parent email so the quoted/threaded context is restored.
  const openDraft = async (d) => {
    const inReplyTo = d.parse_json?.in_reply_to || null
    let original = null
    if (inReplyTo) {
      try { original = await getEmailByMessageId(inReplyTo) } catch { /* parent may be gone */ }
    }
    openCompose({
      mode: inReplyTo ? 'reply' : 'new',
      draftId: d.id,
      draftThreadId: d.thread_id || null,
      draftInReplyTo: inReplyTo,
      originalEmail: original,
      prefillTo: (d.to_addresses || []).join(', '),
      prefillCc: (d.cc_addresses || []).join(', '),
      prefillSubject: d.subject || '',
      prefillBody: d.body_html || d.body_text || '',
      applicationId: d.linked_application_id || null,
    })
  }

  const onDeleteDraft = async (d, e) => {
    e?.stopPropagation()
    if (!window.confirm('Delete this draft?')) return
    try {
      await deleteEmail(d.id)
      setEmails(prev => prev.filter(x => x.id !== d.id))
      loadDraftCount()
      toast.success('Draft deleted')
    } catch { toast.error('Could not delete draft') }
  }

  const onArchive = async () => {
    if (!sel) return
    try {
      await updateEmail(sel.id, { folder: 'archive' })
      setEmails(prev => prev.filter(e => e.id !== sel.id))
      toast.success('Archived')
    } catch { toast.error('Archive failed') }
  }

  const onStar = async () => {
    if (!sel) return
    const next = !sel.is_starred
    try {
      await updateEmail(sel.id, { is_starred: next })
      setEmails(prev => prev.map(e => e.id === sel.id ? { ...e, is_starred: next } : e))
    } catch { toast.error('Could not star') }
  }

  const onConfirmParse = async () => {
    if (!sel) return
    try {
      await updateEmail(sel.id, { parse_status: 'parsed' })
      setEmails(prev => prev.map(e => e.id === sel.id ? { ...e, parse_status: 'parsed' } : e))
      toast.success('Parse confirmed')
    } catch { toast.error('Update failed') }
  }

  return (
    <>
      <AppBar title="Inbox" crumbs={`${HIRED_EMAIL} · all job email`} />
      <PageActions
        left={
          <div className="seg">
            <button className={feed === 'parsed' ? 'on' : ''} onClick={() => setFeed('parsed')}>Parsed feed</button>
            <button className={feed === 'raw' ? 'on' : ''} onClick={() => setFeed('raw')}>Raw inbox</button>
          </div>
        }
        right={<button className="btn ghost tiny"><SettingsIcon size={13} />Forwarding rules</button>}
      />
      <div className="inbox-wrap">
        <div className="mail-folders">
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
            onClick={() => openCompose({ mode: 'new' })}>
            <PenSquare size={14} />Compose
          </button>
          <div className="hired-email-card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Your Hired email</div>
            <div className="addr">{HIRED_EMAIL}</div>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <button className="btn ghost tiny" onClick={onCopy} style={{ flex: 1, justifyContent: 'center' }}>
                {copied ? <><Check size={12} />Copied</> : <>Copy</>}
              </button>
              <button className="btn ghost tiny" style={{ flex: 1, justifyContent: 'center' }} onClick={() => toast('Coming via QR scan in mobile')}>QR</button>
            </div>
            <div className="hint">Use this when applying. We auto-parse every reply and update your tracker.</div>
          </div>
          <div className="eyebrow" style={{ padding: '4px 10px 8px' }}>Folders</div>
          {FOLDERS.map(f => {
            const Icon = f.Icon
            return (
              <div key={f.k} className={`nav-item ${folder === f.k ? 'active' : ''}`} onClick={() => setFolder(f.k)}>
                <span className="ico" style={{ color: f.accent ? 'var(--accent)' : f.warn ? 'var(--warn)' : 'inherit' }}>
                  <Icon size={15} strokeWidth={1.6} />
                </span>
                <span>{f.n}</span>
                {f.k === 'draft' && draftCount > 0 && <span className="folder-count">{draftCount}</span>}
              </div>
            )
          })}
          <div className="eyebrow" style={{ padding: '22px 10px 8px' }}>Connected</div>
          <div style={{ padding: '8px 10px', fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="dot" style={{ background: 'var(--good)' }} />
              <b>Hired forward</b>
            </div>
            <div className="mono muted" style={{ fontSize: 10, marginTop: 6 }}>ACTIVE</div>
          </div>
        </div>

        <div className="mail-list">
          {folder !== 'draft' && (
            <div className="ai-parsed-banner">
              <span className="ico"><Sparkles size={11} /></span>
              <span><b>AI parses every email</b> · linked to applications · interview times pulled to calendar</span>
            </div>
          )}
          {loading ? (
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3,4].map(i => <div key={i} className="skel" style={{ height: 64 }} />)}
            </div>
          ) : grouped.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12.5 }}>
              {folder === 'draft' ? 'No drafts yet.' : (
                <>
                  No emails in this folder.
                  <div style={{ fontSize: 11, marginTop: 6 }}>
                    Forward to <span className="mono" style={{ color: 'var(--accent)' }}>{HIRED_EMAIL}</span>
                  </div>
                </>
              )}
            </div>
          ) : folder === 'draft' ? (
            grouped.map(d => (
              <div key={d.id} className={`mail-row ${selId === d.id ? 'on' : ''}`} onClick={() => openDraft(d)}>
                <div className="from-row">
                  <span className="from">{(d.to_addresses || []).join(', ') || 'No recipients'}</span>
                  <span className="when">{relTime(d.received_at)}</span>
                </div>
                <div className="subj">{d.subject || 'No subject'}</div>
                <div className="preview">{d.snippet || (d.body_text || '').slice(0, 160) || 'Empty draft'}</div>
                <div className="row" style={{ gap: 4, marginTop: 2 }}>
                  <span className="tag" style={{ color: 'var(--ink-3)' }}>Draft</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn ghost tiny" title="Delete draft" onClick={(e) => onDeleteDraft(d, e)}><Trash2 size={12} /></button>
                </div>
              </div>
            ))
          ) : grouped.map(e => (
            <div key={e.id}
              className={`mail-row ${e.threadHasUnread ? 'unread' : ''} ${selId === e.id ? 'on' : ''}`}
              onClick={() => selectRow(e)}>
              <div className="from-row">
                <span className="from">{e.from_name || e.from_email}</span>
                <span className="when">{relTime(e.received_at)}</span>
              </div>
              <div className="subj">
                {e.threadCount > 1 ? e.threadSubject : cleanSubject(e.subject)}
                {e.threadCount > 1 && <span className="thread-badge">{e.threadCount}</span>}
              </div>
              <div className="preview">{e.snippet || (e.body_text || '').slice(0, 160)}</div>
              <div className="row" style={{ gap: 4, marginTop: 2 }}>
                {e.parse_json?.stage_signal ? <StatusPill s={e.parse_json.stage_signal} /> : (
                  e.parse_status === 'needs_review' ? <span className="tag warn"><Flag size={10} />needs review</span> : null
                )}
                {e.linked_application_id && <span className="tag indigo"><LinkIcon size={10} />linked</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="mail-pane">
          {folder === 'draft' ? (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>
              <div>
                <FileText size={28} style={{ opacity: 0.4 }} />
                <div style={{ marginTop: 8, fontSize: 12.5 }}>Click a draft to keep editing it.</div>
              </div>
            </div>
          ) : !sel ? (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
              Select an email
            </div>
          ) : isThreadView ? (
            // ── Threaded conversation view ──────────────────────────────────
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <EmailActions email={threadEmails[threadEmails.length - 1]} />
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{threadEmails.length} messages</span>
              </div>
              <h2>{cleanSubject(threadEmails[0].subject)}</h2>
              <div className="thread-list" style={{ marginTop: 12 }}>
                {threadEmails.map((em) => {
                  const open = expanded.has(em.id)
                  return (
                    <div key={em.id} className={`thread-msg ${open ? 'open' : ''} ${em.is_unread ? 'unread' : ''}`}>
                      <div className="thread-msg-head" onClick={() => toggleExpand(em.id)}>
                        <Logo co={em.parse_json?.company || em.application?.company?.name} size={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row" style={{ gap: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: em.is_unread ? 700 : 600 }}>{em.from_name || em.from_email}</span>
                            {em.folder === 'sent' && <span className="tag" style={{ fontSize: 9.5 }}>sent</span>}
                            <span style={{ flex: 1 }} />
                            <span className="mono muted" style={{ fontSize: 10 }}>{relTime(em.received_at)}</span>
                          </div>
                          {!open && (
                            <div className="thread-snippet">{em.snippet || (em.body_text || '').slice(0, 120)}</div>
                          )}
                        </div>
                      </div>
                      {open && (
                        <div className="thread-body">
                          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-line' }}>
                            {em.body_text || em.snippet || '—'}
                          </div>
                          <EmailAttachments email={em} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <EmailActions email={threadEmails[threadEmails.length - 1]} />
              </div>
            </>
          ) : (
            // ── Single-email reading pane (unchanged) ───────────────────────
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <EmailActions email={sel} />
                <span style={{ flex: 1 }} />
                <button className="btn ghost tiny" onClick={onArchive} title="Archive"><Archive size={13} /></button>
                <button className="btn ghost tiny" onClick={onStar} title="Star" style={{ color: sel.is_starred ? '#f59e0b' : undefined }}>
                  <Star size={13} fill={sel.is_starred ? 'currentColor' : 'none'} />
                </button>
                <button className="btn ghost tiny"><Flag size={13} /></button>
                <button className="btn ghost tiny"><MoreHorizontal size={13} /></button>
              </div>
              <h2>{sel.subject}</h2>
              <div className="row" style={{ marginTop: 10, marginBottom: 4 }}>
                <Logo co={sel.parse_json?.company || sel.application?.company?.name} size={36} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{sel.from_name || sel.from_email}</div>
                  <div className="mono muted" style={{ fontSize: 10.5 }}>to me · {relTime(sel.received_at)}</div>
                </div>
                {sel.linked_application_id && (
                  <button className="btn ghost tiny" onClick={() => openDrawer(sel.linked_application_id)}>
                    <LinkIcon size={12} />Open application <ArrowRight size={11} />
                  </button>
                )}
              </div>

              {sel.parse_json && (
                <div className="parsed-strip">
                  <div className="head">
                    <div style={{ width: 16, height: 16, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                      <Sparkles size={9} />
                    </div>
                    AI parsed this email · {sel.parse_status === 'needs_review' ? 'low confidence — please confirm' : `${Math.round((sel.linked_confidence || 0.92) * 100)}% confidence`}
                    <span style={{ flex: 1 }} />
                    {sel.linked_application_id && <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent-ink)' }}>↳ linked to application</span>}
                  </div>
                  <div className="entities">
                    {sel.parse_json.company && <span className="entity">company · <b>{sel.parse_json.company}</b></span>}
                    {sel.parse_json.stage_signal && <span className="entity">stage · <b>{STAGE_LABEL[sel.parse_json.stage_signal]}</b></span>}
                    {sel.parse_json.contact?.name && <span className="entity">contact · <b>{sel.parse_json.contact.name}</b></span>}
                    {sel.parse_json.interview_slots?.[0] && <span className="entity">date · <b>{sel.parse_json.interview_slots[0].label || 'Interview'}</b></span>}
                  </div>
                  {sel.parse_status === 'needs_review' && (
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn indigo tiny" onClick={onConfirmParse}><Check size={12} />Confirm</button>
                      <button className="btn ghost tiny"><Edit2 size={12} />Edit</button>
                    </div>
                  )}
                </div>
              )}

              <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-line', marginTop: 8 }}>
                {sel.body_text || sel.snippet || '—'}
              </div>

              <EmailAttachments email={sel} />

              <div className="row" style={{ gap: 6, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <EmailActions email={sel} />
              </div>

              <EmailReplies email={sel} />
            </>
          )}
        </div>
      </div>
    </>
  )
}
