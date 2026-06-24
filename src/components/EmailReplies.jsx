import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, RefreshCw, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import { callProxy, trackUsage, MODELS } from '../lib/ai'

// Tone options. Each generates ONE reply (1 credit). `Gracious` is only
// offered when the linked application was rejected/ghosted — see TONES_FOR().
const TONES = {
  professional: { label: 'Professional', hint: 'clean and corporate' },
  enthusiastic: { label: 'Enthusiastic', hint: 'warm and excited' },
  brief:        { label: 'Brief',        hint: '2-3 sentences max' },
  casual:       { label: 'Casual',       hint: 'friendly, conversational' },
  gracious:     { label: 'Gracious',     hint: 'thanks them, asks for feedback' },
}

function tonesFor(stage) {
  const base = ['professional', 'enthusiastic', 'brief', 'casual']
  if (stage === 'reject' || stage === 'ghost') base.push('gracious')
  return base
}

const SYSTEM_PROMPT = `You are an email reply assistant for job seekers. Given an inbound email from a recruiter or company, generate a single reply in the specified tone.

Tone definitions:
- Professional: Polished, concise, corporate-appropriate. No fluff.
- Enthusiastic: Warm, genuinely excited, shows gratitude and eagerness.
- Brief: 2-3 sentences maximum. Direct and to the point.
- Casual: Friendly and conversational, like texting a colleague.
- Gracious: Thankful for the opportunity, gracefully accepts the outcome, and asks if there's feedback or future opportunities.

Rules:
- Write a complete, ready-to-send email body (no subject line).
- Never invent facts about the candidate.
- If the inbound email is a rejection, adjust tone to be appropriate regardless of selected tone.
- Match the length to the tone (Brief = short, others = medium).
- Sign off with [Your name] as placeholder.
- Do NOT wrap in markdown or code fences.`

// Per-email cache of the last generated reply, so switching emails away and
// back shows the previous result without spending another credit. Module-level
// (survives remounts within a session) keyed by email id.
const replyCache = new Map()

// AI-generated email replies. Each generation is user-triggered (tap a tone
// pill), costs one `email_replies` credit, and produces a single editable
// draft. "Use" loads the draft into the floating composer (rich text +
// attachments + real send). Shared by the Inbox pane and the EmailDrawer.
export default function EmailReplies({ email }) {
  const { user } = useAuth()
  const { openUpgrade, openCompose } = useUI()
  const { allowed, used, limit, refresh } = useLimit('email_replies')

  const [tone, setTone] = useState(null)
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)
  // Optimistic remaining: decremented locally on a successful generation so the
  // count updates instantly. Cleared back to server-truth whenever `used`
  // changes (i.e. the hook's refresh has caught up).
  const [override, setOverride] = useState(null)

  const app = email.application
  const stage = app?.stage || null
  const tones = tonesFor(stage)

  const unlimited = limit < 0
  const baseRemaining = unlimited ? Infinity : Math.max(0, limit - used)
  const remaining = override != null ? override : baseRemaining
  const outOfCredits = !unlimited && remaining <= 0

  // Restore the cached reply when switching to a different email; clear local
  // draft/tone otherwise. Also reset the optimistic override on email change.
  useEffect(() => {
    const cached = replyCache.get(email.id)
    setReply(cached?.text || '')
    setTone(cached?.tone || null)
    setOverride(null)
    setLoading(false)
  }, [email.id])

  // Once the hook's `used` count reflects our generation, drop the optimistic
  // override so the server is the source of truth again.
  useEffect(() => { setOverride(null) }, [used])

  const generate = async (selectedTone) => {
    if (loading) return
    if (!guardLimit({ allowed, feature: 'email_replies', openUpgrade })) return

    setTone(selectedTone)
    setLoading(true)
    try {
      const context = [
        app?.company?.name && `Company: ${app.company.name}`,
        app?.role_title && `Role: ${app.role_title}`,
        stage && `Current stage: ${stage}`,
      ].filter(Boolean).join('\n') || 'No linked application context available.'

      const inbound = email.body_text || email.snippet || '(no body)'
      const userMessage = `Context about the job:\n${context}\n\nTone: ${TONES[selectedTone].label}\n\nInbound email from ${email.from_name || email.from_email}:\nSubject: ${email.subject || '(no subject)'}\n\n${inbound}\n\nWrite the reply now.`

      const data = await callProxy({
        systemPrompt: SYSTEM_PROMPT,
        userMessage,
        model: MODELS.fast,
        max_tokens: 800,
      })
      const text = data?.content?.[0]?.text
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('empty')
      }
      const clean = text.trim()
      setReply(clean)
      replyCache.set(email.id, { tone: selectedTone, text: clean })

      // Charge exactly one credit and update the count immediately.
      if (user?.id) {
        await trackUsage(
          user.id, 'email_replies', MODELS.fast,
          data?.usage?.input_tokens || 0, data?.usage?.output_tokens || 0,
          email.linked_application_id || null,
        )
        if (!unlimited) setOverride(Math.max(0, remaining - 1))
        refresh()
      }
    } catch {
      toast.error("Couldn't generate reply — try again")
    } finally {
      setLoading(false)
    }
  }

  // Load the generated reply into the floating composer (pre-filled, with the
  // original quoted below) so the user can format, attach, and send for real.
  const onUse = () => {
    if (!reply.trim()) return
    const subject = /^re:/i.test(email.subject || '') ? email.subject : `Re: ${email.subject || ''}`
    openCompose({
      mode: 'reply',
      originalEmail: email,
      prefillBody: reply,
      prefillTo: email.from_email,
      prefillSubject: subject,
      applicationId: email.linked_application_id,
    })
  }

  const creditLabel = unlimited
    ? 'Unlimited replies'
    : `${remaining} reply credit${remaining === 1 ? '' : 's'} left this month`

  return (
    <div style={{ marginTop: 28, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div style={{ width: 22, height: 22, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <Sparkles size={11} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Generate a reply</span>
        <span className="mono muted" style={{ fontSize: 10.5, marginLeft: 'auto' }}>
          {outOfCredits
            ? <>No reply credits left — <button onClick={() => openUpgrade('email_replies')} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--accent-ink)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>See plans</button></>
            : creditLabel}
        </span>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: reply || loading ? 12 : 0 }}>
        {tones.map(k => (
          <button
            key={k}
            className={`btn tiny ${tone === k ? 'indigo' : 'ghost'}`}
            disabled={outOfCredits || loading}
            title={TONES[k].hint}
            onClick={() => generate(k)}
          >
            {loading && tone === k ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
            {TONES[k].label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card card-pad" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-2)', fontSize: 12 }}>
          <Loader2 size={14} className="spin" />
          Writing a {tone ? TONES[tone].label.toLowerCase() : ''} reply…
        </div>
      )}

      {!loading && reply && (
        <div className="card card-pad" style={{ padding: 12 }}>
          <textarea
            value={reply}
            onChange={e => {
              setReply(e.target.value)
              replyCache.set(email.id, { tone, text: e.target.value })
            }}
            rows={8}
            style={{ width: '100%', resize: 'vertical', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 12.5, lineHeight: 1.5, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--ink)' }}
          />
          <div className="row" style={{ gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            <button
              className="btn ghost tiny"
              disabled={loading || outOfCredits}
              onClick={() => tone && generate(tone)}
              title="Generate a new reply with the same tone (costs 1 credit)"
            >
              <RefreshCw size={11} />Regenerate
            </button>
            <button className="btn indigo tiny" onClick={onUse}>
              <Send size={11} />Use
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
