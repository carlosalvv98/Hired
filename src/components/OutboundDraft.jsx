import { useEffect, useState } from 'react'
import { Sparkles, Send, RefreshCw, Loader2, Copy, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { useStyleLearner } from '../hooks/useStyleLearner'
import { guardLimit } from '../lib/limitGuard'
import { callProxy, trackUsage, extractJson, MODELS } from '../lib/ai'
import { buildDraftStyleSystem } from '../lib/agents/styleAnalyzer'
import { relTime } from '../lib/time'

// Outbound email drafter — thank-you notes, follow-ups, and cold outreach the
// USER sends to a recruiter (as opposed to EmailReplies.jsx, which drafts
// replies to inbound mail). Shares the same 'email_replies' credit pool and
// tone pills; "Use" hands the draft off to the floating composer for sending.

const PURPOSES = {
  thank_you:    { label: '🙏 Thank You',    hint: 'post-interview gratitude' },
  follow_up:    { label: '📩 Follow Up',    hint: 'checking in on status' },
  introduction: { label: '👋 Introduction', hint: 'cold outreach to a new contact' },
  question:     { label: '❓ Question',      hint: 'role / process / next steps' },
}

const TONES = {
  professional: { label: 'Professional', hint: 'clean and corporate' },
  enthusiastic: { label: 'Enthusiastic', hint: 'warm and excited' },
  brief:        { label: 'Brief',        hint: '3-4 sentences max' },
  casual:       { label: 'Casual',       hint: 'friendly, conversational' },
}

// draftType → auto-selected purpose (so the caller's intent skips the picker).
const DRAFT_TYPE_PURPOSE = { thank_you: 'thank_you', follow_up: 'follow_up', outreach: 'introduction' }
const DRAFT_TYPE_LABEL = {
  thank_you: 'Thank-You Note', follow_up: 'Follow-Up', outreach: 'Outreach', custom: 'Draft Email',
}

const SYSTEM_PROMPT = `You are an email drafting assistant for job seekers. Write a single outbound email based on the specified purpose and tone.

Purpose definitions:
- Thank You: Grateful follow-up after an interview or meeting. Reference something specific about the conversation (prompt the user to fill in a detail). Express genuine enthusiasm for the role.
- Follow Up: Polite check-in on application status. Not pushy. Reaffirm interest. Appropriate when it's been 1-2 weeks since last contact.
- Introduction: Cold outreach to someone at the company. Brief, respectful of their time, clear about why you're reaching out.
- Question: Asking about the role, interview process, timeline, or next steps. Direct and specific.

Tone definitions:
- Professional: Polished, concise, corporate-appropriate.
- Enthusiastic: Warm, genuinely excited, shows energy.
- Brief: 3-4 sentences max. Straight to the point.
- Casual: Friendly and conversational.

Rules:
- Generate BOTH a subject line and email body.
- Never invent facts about the candidate or the conversation.
- For Thank You emails, include a placeholder like [specific detail from your conversation] that the user can fill in — this makes it personal.
- Keep it human — not robotic or formulaic.
- Sign off with [Your name].
- Do NOT wrap in markdown or code fences.
- Respond ONLY in JSON: {"subject": "...", "body": "..."}`

// Per (application + draftType) cache, so closing and reopening the drafter
// for the same context shows the last draft without spending another credit.
const draftCache = new Map()

export default function OutboundDraft({
  application, draftType = 'custom', recipientEmail = '', recipientName = '', onClose,
}) {
  const app = application || {}
  const { user } = useAuth()
  const { openUpgrade, openCompose } = useUI()
  const { allowed, used, limit, refresh } = useLimit('email_replies')
  const { styleEnabled, hasStyle, style, learning, learnStyle } = useStyleLearner()

  const cacheKey = `${app.id || 'none'}:${draftType}`
  const presetPurpose = DRAFT_TYPE_PURPOSE[draftType] || null
  const showPurposePicker = !presetPurpose // only 'custom' lets the user pick

  const [purpose, setPurpose] = useState(presetPurpose)
  const [tone, setTone] = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [toEmail, setToEmail] = useState(recipientEmail || '')
  const [loading, setLoading] = useState(false)
  const [override, setOverride] = useState(null)

  const unlimited = limit < 0
  const baseRemaining = unlimited ? Infinity : Math.max(0, limit - used)
  const remaining = override != null ? override : baseRemaining
  const outOfCredits = !unlimited && remaining <= 0

  // Restore a cached draft when the context (app + type) changes.
  useEffect(() => {
    const cached = draftCache.get(cacheKey)
    setPurpose(cached?.purpose || presetPurpose)
    setTone(cached?.tone || null)
    setSubject(cached?.subject || '')
    setBody(cached?.body || '')
    setToEmail(recipientEmail || '')
    setOverride(null)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])

  // Drop the optimistic count once the hook's server-truth catches up.
  useEffect(() => { setOverride(null) }, [used])

  const generate = async () => {
    if (loading || !purpose || !tone) return
    if (!guardLimit({ allowed, feature: 'email_replies', openUpgrade })) return

    setLoading(true)
    try {
      const context = [
        app.company?.name && `Company: ${app.company.name}`,
        app.role_title && `Role: ${app.role_title}`,
        app.stage && `Current stage: ${app.stage}`,
        (recipientName || toEmail) && `Recipient: ${[recipientName, toEmail].filter(Boolean).join(', ')}`,
        app.last_activity_at && `Last activity: ${relTime(app.last_activity_at)}`,
      ].filter(Boolean).join('\n') || 'No application context available.'

      const isStyle = tone === 'my_style'
      const userMessage =
        `Context:\n${context}\n\n` +
        `Purpose: ${PURPOSES[purpose].label.replace(/^[^\w]+/, '').trim()}\n` +
        `${isStyle ? '' : `Tone: ${TONES[tone].label}\n`}\nWrite the email now.`

      const data = await callProxy({
        systemPrompt: isStyle ? buildDraftStyleSystem(style) : SYSTEM_PROMPT,
        userMessage,
        model: MODELS.fast,
        max_tokens: 1000,
      })
      const text = data?.content?.[0]?.text
      if (typeof text !== 'string' || !text.trim()) throw new Error('empty')
      const parsed = extractJson(text)
      const nextSubject = String(parsed.subject || '').trim()
      const nextBody = String(parsed.body || '').trim()
      if (!nextBody) throw new Error('empty body')

      setSubject(nextSubject)
      setBody(nextBody)
      draftCache.set(cacheKey, { purpose, tone, subject: nextSubject, body: nextBody })

      if (user?.id) {
        await trackUsage(
          user.id, 'email_replies', MODELS.fast,
          data?.usage?.input_tokens || 0, data?.usage?.output_tokens || 0,
          app.id || null,
        )
        if (!unlimited) setOverride(Math.max(0, remaining - 1))
        refresh()
      }
    } catch {
      toast.error("Couldn't draft that email — try again")
    } finally {
      setLoading(false)
    }
  }

  // Hand the AI draft off to the floating composer (rich text + attachments +
  // real send via email-outbound) instead of opening a mailto link.
  const onUse = () => {
    if (!body.trim()) return
    openCompose({
      mode: 'new',
      prefillTo: toEmail.trim() || recipientEmail || '',
      prefillSubject: subject,
      prefillBody: body,
      applicationId: app?.id || null,
    })
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      toast.success('Copied to clipboard')
    } catch { toast.error('Copy failed') }
  }

  const cacheDraft = (patch) => {
    const next = { purpose, tone, subject, body, ...patch }
    draftCache.set(cacheKey, next)
  }

  const creditLabel = unlimited
    ? 'Unlimited drafts'
    : `${remaining} reply credit${remaining === 1 ? '' : 's'} left this month`

  return (
    <div className="card card-pad" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div className="row" style={{ gap: 8 }}>
        <div style={{ width: 22, height: 22, background: 'linear-gradient(135deg, var(--accent), #a78bfa)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <Sparkles size={11} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{DRAFT_TYPE_LABEL[draftType] || 'Draft Email'}</span>
        <span className="mono muted" style={{ fontSize: 10.5, marginLeft: 'auto' }}>
          {outOfCredits
            ? <>No reply credits left — <button onClick={() => openUpgrade('email_replies')} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--accent-ink)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>See plans</button></>
            : creditLabel}
        </span>
        {onClose && (
          <button className="btn ghost icon" onClick={onClose} title="Close" style={{ marginLeft: 4 }}>
            <X size={13} />
          </button>
        )}
      </div>

      {/* Recipient */}
      <div>
        <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 4 }}>To</div>
        {recipientEmail ? (
          <div style={{ fontSize: 12.5 }}>
            {recipientName ? <span style={{ fontWeight: 600 }}>{recipientName} </span> : null}
            <span className="mono muted" style={{ fontSize: 11.5 }}>{recipientEmail}</span>
          </div>
        ) : (
          <input
            type="email" value={toEmail} onChange={e => setToEmail(e.target.value)}
            placeholder="recruiter@company.com" spellCheck={false}
            style={{ width: '100%', fontSize: 12.5, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 7, outline: 'none', background: '#fff' }}
          />
        )}
      </div>

      {/* Purpose pills (custom only) */}
      {showPurposePicker && (
        <div>
          <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 6 }}>Purpose</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {Object.keys(PURPOSES).map(k => (
              <button key={k} className={`btn tiny ${purpose === k ? 'indigo' : 'ghost'}`}
                title={PURPOSES[k].hint} disabled={loading}
                onClick={() => setPurpose(k)}>
                {PURPOSES[k].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tone pills */}
      <div>
        <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 6 }}>Tone</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {styleEnabled && (hasStyle ? (
            <button className={`btn tiny style-pill ${tone === 'my_style' ? 'on' : ''}`}
              title="Draft in your learned writing voice" disabled={loading}
              onClick={() => setTone('my_style')}>
              <Sparkles size={11} />My Style
            </button>
          ) : (
            <button className="btn tiny style-pill learn"
              title="Analyze your sent emails to learn your writing voice"
              disabled={loading || learning}
              onClick={learnStyle}>
              {learning ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
              {learning ? 'Analyzing…' : 'Learn My Style'}
            </button>
          ))}
          {Object.keys(TONES).map(k => (
            <button key={k} className={`btn tiny ${tone === k ? 'indigo' : 'ghost'}`}
              title={TONES[k].hint} disabled={loading}
              onClick={() => setTone(k)}>
              {TONES[k].label}
            </button>
          ))}
        </div>
      </div>

      {/* Generate */}
      <button className="btn ai" disabled={loading || outOfCredits || !purpose || !tone}
        onClick={generate} style={{ alignSelf: 'flex-start' }}>
        {loading ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
        {loading ? 'Drafting…' : 'Draft Email'}
      </button>

      {/* Output */}
      {!loading && body && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 4 }}>Subject</div>
            <input
              type="text" value={subject}
              onChange={e => { setSubject(e.target.value); cacheDraft({ subject: e.target.value }) }}
              style={{ width: '100%', fontSize: 12.5, fontWeight: 600, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 7, outline: 'none', background: '#fff' }}
            />
          </div>
          <div>
            <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 4 }}>Body</div>
            <textarea
              value={body}
              onChange={e => { setBody(e.target.value); cacheDraft({ body: e.target.value }) }}
              rows={9}
              style={{ width: '100%', resize: 'vertical', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 12.5, lineHeight: 1.5, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--ink)' }}
            />
          </div>
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn ghost tiny" onClick={onCopy} title="Copy subject + body">
              <Copy size={11} />Copy
            </button>
            <button className="btn ghost tiny" disabled={loading || outOfCredits} onClick={generate}
              title="Generate a new draft with the same purpose + tone (costs 1 credit)">
              <RefreshCw size={11} />Regenerate
            </button>
            <button className="btn indigo tiny" onClick={onUse}>
              <Send size={11} />Use
            </button>
          </div>
          <div className="muted" style={{ fontSize: 10.5 }}>
            You can also send this from your personal email.
          </div>
        </div>
      )}
    </div>
  )
}
