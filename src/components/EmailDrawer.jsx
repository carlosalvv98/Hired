import { useEffect, useState } from 'react'
import { X, Sparkles, Link as LinkIcon, ArrowRight } from 'lucide-react'
import Logo from './Logo'
import StatusPill from './StatusPill'
import EmailReplies from './EmailReplies'
import { EmailActions, EmailAttachments } from './EmailActions'
import { getEmail, updateEmail } from '../lib/api'
import { useUI } from '../hooks/useUI'
import { relTime } from '../lib/time'
import { STAGE_LABEL } from '../lib/stages'
import toast from 'react-hot-toast'

// Right-hand side view for a single email. Mirrors the application Drawer's
// look (.drawer / .drawer-scrim) so opening an email from the dashboard or
// elsewhere feels identical to opening an application.
export default function EmailDrawer({ id, onClose }) {
  const { openDrawer, closeEmail } = useUI()
  const [email, setEmail] = useState(null)

  useEffect(() => {
    let alive = true
    getEmail(id)
      .then(e => {
        if (!alive) return
        setEmail(e)
        // Mark read on open, same as the inbox list does.
        if (e.is_unread) {
          updateEmail(id, { is_unread: false }).catch(() => {})
          setEmail(prev => prev ? { ...prev, is_unread: false } : prev)
        }
      })
      .catch(() => { toast.error('Could not load email'); onClose() })
    return () => { alive = false }
  }, [id])

  const openLinkedApp = (appId) => {
    closeEmail()
    openDrawer(appId)
  }

  if (!email) {
    return (
      <>
        <div className="drawer-scrim" onClick={onClose} />
        <div className="drawer">
          <div className="drawer-head"><div className="skel" style={{ height: 80 }} /></div>
        </div>
      </>
    )
  }

  const p = email.parse_json

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="row" style={{ marginBottom: 14 }}>
            <button className="btn ghost icon" onClick={onClose} title="Close"><X size={14} /></button>
            <span className="mono muted" style={{ fontSize: 10.5 }}>EMAIL</span>
            <span style={{ flex: 1 }} />
            {email.linked_application_id && (
              <button className="btn ghost tiny" onClick={() => openLinkedApp(email.linked_application_id)}>
                <LinkIcon size={12} />Open application <ArrowRight size={11} />
              </button>
            )}
          </div>
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <Logo co={p?.company || email.application?.company?.name} size={48} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.015em' }}>{email.subject}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
                {email.from_name || email.from_email} · <span className="mono">to me · {relTime(email.received_at)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="drawer-body">
          {p && (
            <div className="parsed-strip" style={{ marginBottom: 16 }}>
              <div className="head">
                <div style={{ width: 16, height: 16, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <Sparkles size={9} />
                </div>
                AI parsed this email
                <span style={{ flex: 1 }} />
                {email.linked_application_id && <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent-ink)' }}>↳ linked to application</span>}
              </div>
              <div className="entities">
                {p.company && <span className="entity">company · <b>{p.company}</b></span>}
                {p.stage_signal && <span className="entity">stage · <b>{STAGE_LABEL[p.stage_signal] || p.stage_signal}</b></span>}
                {p.contact?.name && <span className="entity">contact · <b>{p.contact.name}</b></span>}
                {p.interview_slots?.[0] && <span className="entity">date · <b>{p.interview_slots[0].label || 'Interview'}</b></span>}
              </div>
            </div>
          )}

          {p?.stage_signal && (
            <div style={{ marginBottom: 14 }}><StatusPill s={p.stage_signal} /></div>
          )}

          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-line' }}>
            {email.body_text || email.snippet || '—'}
          </div>

          <EmailAttachments email={email} />

          <div className="row" style={{ gap: 6, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <EmailActions email={email} />
          </div>

          <EmailReplies email={email} />
        </div>
      </div>
    </>
  )
}
