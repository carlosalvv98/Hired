import { useMemo } from 'react'
import { Sparkles, Send } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import { trackUsage } from '../lib/ai'

// AI-suggested replies for an email. Each "Use" is metered against the
// `email_replies` quota (charged via trackUsage) and opens the user's mail
// client pre-filled. Shared by the Inbox pane and the EmailDrawer.
export default function EmailReplies({ email }) {
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
