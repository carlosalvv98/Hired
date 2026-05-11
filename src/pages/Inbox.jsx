import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Inbox as InboxIcon, Flag, Star, Archive, Settings as SettingsIcon, Check, Edit2, Link as LinkIcon, MoreHorizontal, X, ArrowRight, Send } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import Logo from '../components/Logo'
import StatusPill from '../components/StatusPill'
import { listEmails, updateEmail } from '../lib/api'
import { relTime } from '../lib/time'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import { trackUsage } from '../lib/ai'
import { STAGE_LABEL } from '../lib/stages'
import toast from 'react-hot-toast'

const FOLDERS = [
  { k: 'inbox',    n: 'All inbox',       Icon: InboxIcon },
  { k: 'parsed',   n: 'Auto-parsed',     Icon: Sparkles, accent: true },
  { k: 'unlinked', n: 'Needs review',    Icon: Flag, warn: true },
  { k: 'starred',  n: 'Starred',         Icon: Star },
  { k: 'archive',  n: 'Archive',         Icon: Archive },
]

export default function Inbox() {
  const { profile } = useAuth()
  const { openDrawer } = useUI()
  const [folder, setFolder] = useState('inbox')
  const [emails, setEmails] = useState([])
  const [selId, setSelId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [feed, setFeed] = useState('parsed')

  const load = async () => {
    setLoading(true)
    try {
      const e = await listEmails({ folder })
      setEmails(e)
      if (e.length && !selId) setSelId(e[0].id)
    } catch (err) {
      toast.error('Could not load emails')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [folder])

  const filtered = useMemo(() => {
    if (feed === 'parsed') return emails.filter(e => e.parse_status === 'parsed' || e.parse_status === 'needs_review')
    return emails
  }, [emails, feed])

  const sel = emails.find(e => e.id === selId) || filtered[0]
  const HIRED_EMAIL = profile?.forwarding_address || `hired-${profile?.handle || 'me'}@hired.app`

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(HIRED_EMAIL)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { toast.error('Copy failed') }
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
          <div className="ai-parsed-banner">
            <span className="ico"><Sparkles size={11} /></span>
            <span><b>AI parses every email</b> · linked to applications · interview times pulled to calendar</span>
          </div>
          {loading ? (
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3,4].map(i => <div key={i} className="skel" style={{ height: 64 }} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12.5 }}>
              No emails in this folder.
              <div style={{ fontSize: 11, marginTop: 6 }}>
                Forward to <span className="mono" style={{ color: 'var(--accent)' }}>{HIRED_EMAIL}</span>
              </div>
            </div>
          ) : filtered.map(e => (
            <div key={e.id}
              className={`mail-row ${e.is_unread ? 'unread' : ''} ${selId === e.id ? 'on' : ''}`}
              onClick={() => {
                setSelId(e.id)
                if (e.is_unread) {
                  updateEmail(e.id, { is_unread: false }).catch(() => {})
                  setEmails(prev => prev.map(x => x.id === e.id ? { ...x, is_unread: false } : x))
                }
              }}>
              <div className="from-row">
                <span className="from">{e.from_name || e.from_email}</span>
                <span className="when">{relTime(e.received_at)}</span>
              </div>
              <div className="subj">{e.subject}</div>
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
          {!sel ? (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
              Select an email
            </div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <button className="btn ghost tiny" onClick={onArchive}><Archive size={13} /></button>
                <button className="btn ghost tiny" onClick={onStar} style={{ color: sel.is_starred ? '#f59e0b' : undefined }}>
                  <Star size={13} fill={sel.is_starred ? 'currentColor' : 'none'} />
                </button>
                <button className="btn ghost tiny"><Flag size={13} /></button>
                <span style={{ flex: 1 }} />
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

              <Replies email={sel} />
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Replies({ email }) {
  const { user } = useAuth()
  const { openUpgrade } = useUI()
  const { allowed: replyAllowed, refresh: refreshReplyLimit } = useLimit('email_replies')

  const replies = useMemo(() => {
    const sender = email.from_name?.split(' ')[0] || 'there'
    return [
      { t: 'Quick yes', p: `Hi ${sender} — works great. Looking forward to it.` },
      { t: 'Ask details', p: `Hi ${sender} — can you share more details about the format and panelists?` },
      { t: 'Counter time', p: `Hi ${sender} — none of those slots work for me. Could we do later this week?` },
    ]
  }, [email.id])

  const onUse = async (r) => {
    if (!guardLimit({ allowed: replyAllowed, feature: 'email_replies', openUpgrade })) return
    if (user?.id) {
      await trackUsage(user.id, 'email_replies', 'client-template-v1', 0, 0, email.linked_application_id || null)
      refreshReplyLimit()
    }
    const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`
    const body = encodeURIComponent(r.p)
    window.location.href = `mailto:${email.from_email}?subject=${encodeURIComponent(subject)}&body=${body}`
  }

  return (
    <div style={{ marginTop: 28, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div style={{ width: 22, height: 22, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <Sparkles size={11} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>AI suggested replies</span>
        <span className="mono muted" style={{ fontSize: 10.5 }}>3 variants</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {replies.map((s, i) => (
          <div key={i} className="card card-pad" style={{ padding: 12, fontSize: 11.5, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent-ink)' }}>{s.t}</div>
            <div style={{ color: 'var(--ink-2)' }}>"{s.p}"</div>
            <div className="row" style={{ marginTop: 8, gap: 4 }}>
              <button className="btn indigo tiny" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onUse(s)}>
                <Send size={11} />Use
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
