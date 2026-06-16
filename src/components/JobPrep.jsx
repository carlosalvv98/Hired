/**
 * @file Per-job interview prep panel — shared by the tracker drawer's Notes
 * tab and the Prep dashboard. Wraps three things:
 *   1. AI-organized summary of the job's notes (prep_summary).
 *   2. Questions to ask (standards auto-applied + add from bank / ad-hoc),
 *      each with an "asked" toggle and a recorded response.
 *   3. Ask-AI box grounded in everything known about the job.
 *
 * Token-spending actions are gated on the user's tier via useLimit/guardLimit.
 */
import { useState, useEffect, useCallback } from 'react'
import { Sparkles, Loader2, Plus, Check, Trash2, Send } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import { trackUsage } from '../lib/ai'
import {
  listAppQuestions, ensureStandardQuestions, addAppQuestion, updateAppQuestion,
  deleteAppQuestion, listQuestionBank, updateApplication,
} from '../lib/api'
import { organizeNotes, askPrep, buildJobContext } from '../lib/agents/prep'
import toast from 'react-hot-toast'

// Browser-side HTML → plain text (notes are stored as rich-text HTML).
function htmlToText(html) {
  if (!html) return ''
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.textContent || '').trim()
}

export default function JobPrep({ app, emails = [], onAppPatched }) {
  const { user } = useAuth()
  const { openUpgrade } = useUI()
  const organizeLimit = useLimit('prep_organize')
  const chatLimit = useLimit('prep_chat')

  const [summary, setSummary] = useState(app.prep_summary || '')
  const [organizing, setOrganizing] = useState(false)
  const [questions, setQuestions] = useState([])
  const [bank, setBank] = useState([])
  const [newQ, setNewQ] = useState('')
  const [bankPick, setBankPick] = useState('')

  const [chat, setChat] = useState([])   // [{ role, content }]
  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)

  useEffect(() => { setSummary(app.prep_summary || '') }, [app.prep_summary])

  const loadQuestions = useCallback(async () => {
    try {
      const [qs, b] = await Promise.all([
        ensureStandardQuestions(app.id, user.id),
        listQuestionBank(),
      ])
      setQuestions(qs); setBank(b)
    } catch { /* non-fatal */ }
  }, [app.id, user?.id])

  useEffect(() => { if (user?.id) loadQuestions() }, [loadQuestions, user?.id])

  const notesText = htmlToText(app.notes_md)

  const onOrganize = async () => {
    if (!notesText) { toast.error('Add some notes first, then organize them.'); return }
    if (!guardLimit({ allowed: organizeLimit.allowed, feature: 'prep_organize', openUpgrade })) return
    setOrganizing(true)
    try {
      const { summary: s, _usage } = await organizeNotes(notesText, app.jd_text || '')
      await updateApplication(app.id, { prep_summary: s })
      setSummary(s)
      onAppPatched?.({ prep_summary: s })
      if (user?.id && _usage) {
        await trackUsage(user.id, 'prep_organize', _usage.model, _usage.inputTokens, _usage.outputTokens, app.id)
        organizeLimit.refresh()
      }
      toast.success('Notes organized')
    } catch (e) {
      toast.error(e.message || 'Could not organize notes')
    } finally { setOrganizing(false) }
  }

  const addFromBank = async () => {
    const b = bank.find(x => x.id === bankPick)
    if (!b) return
    try {
      const row = await addAppQuestion({ application_id: app.id, source_question_id: b.id, text: b.text }, user.id)
      setQuestions(qs => [...qs, row]); setBankPick('')
    } catch { toast.error('Could not add question') }
  }

  const addAdHoc = async () => {
    const text = newQ.trim()
    if (!text) return
    try {
      const row = await addAppQuestion({ application_id: app.id, text }, user.id)
      setQuestions(qs => [...qs, row]); setNewQ('')
    } catch { toast.error('Could not add question') }
  }

  const patchQ = async (id, patch) => {
    setQuestions(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q))
    try { await updateAppQuestion(id, patch) } catch { toast.error('Could not save'); loadQuestions() }
  }

  const removeQ = async (id) => {
    setQuestions(qs => qs.filter(q => q.id !== id))
    try { await deleteAppQuestion(id) } catch { toast.error('Could not delete'); loadQuestions() }
  }

  const onAsk = async () => {
    const q = ask.trim()
    if (!q || asking) return
    if (!guardLimit({ allowed: chatLimit.allowed, feature: 'prep_chat', openUpgrade })) return
    setAsking(true)
    setChat(c => [...c, { role: 'user', content: q }])
    setAsk('')
    try {
      const context = buildJobContext({ app, notesText, questions, emails })
      const history = chat.slice(-6)
      const { answer, _usage } = await askPrep(q, context, history)
      setChat(c => [...c, { role: 'assistant', content: answer }])
      if (user?.id && _usage) {
        await trackUsage(user.id, 'prep_chat', _usage.model, _usage.inputTokens, _usage.outputTokens, app.id)
        chatLimit.refresh()
      }
    } catch (e) {
      setChat(c => [...c, { role: 'assistant', content: e.message || 'Something went wrong.' }])
    } finally { setAsking(false) }
  }

  const unaddedBank = bank.filter(b => !questions.some(q => q.source_question_id === b.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Organized summary */}
      <section>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="eyebrow">Organized summary</div>
          <button className="btn ai tiny" onClick={onOrganize} disabled={organizing}>
            {organizing ? <><Loader2 size={11} className="spin" /> Organizing…</> : <><Sparkles size={11} /> Organize with AI</>}
          </button>
        </div>
        {summary ? (
          <div className="card card-pad" style={{ padding: 14, fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {summary}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            Organize your notes into a clean brief (company, comp, process, people…).
          </div>
        )}
      </section>

      {/* Questions to ask */}
      <section>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Questions to ask</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {questions.length === 0 && (
            <div className="muted" style={{ fontSize: 12 }}>No questions yet — add from your bank or write one.</div>
          )}
          {questions.map(q => (
            <div key={q.id} className="card card-pad" style={{ padding: 12 }}>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <button className={`prep-check ${q.asked ? 'on' : ''}`} title={q.asked ? 'Asked' : 'Mark asked'}
                  onClick={() => patchQ(q.id, { asked: !q.asked })}
                  style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
                    border: '1.5px solid var(--line)', background: q.asked ? 'var(--accent)' : '#fff',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}>
                  {q.asked && <Check size={11} />}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.75, fontWeight: 550 }}>{q.text}</div>
                  <textarea
                    value={q.response || ''}
                    onChange={e => setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, response: e.target.value } : x))}
                    onBlur={e => patchQ(q.id, { response: e.target.value.trim() || null })}
                    placeholder="Record their answer…"
                    rows={2}
                    style={{ width: '100%', marginTop: 6, resize: 'vertical', minHeight: 38, font: 'inherit',
                      fontSize: 12, lineHeight: 1.45, padding: '6px 8px', border: '1px solid var(--line)',
                      borderRadius: 6, color: 'var(--ink)', background: '#fff' }}
                  />
                </div>
                <button className="btn ghost icon" onClick={() => removeQ(q.id)} title="Remove"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <input type="text" value={newQ} onChange={e => setNewQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addAdHoc() }}
            placeholder="Add a question…"
            style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, font: 'inherit', fontSize: 12.5 }} />
          <button className="btn ghost tiny" onClick={addAdHoc} disabled={!newQ.trim()}><Plus size={12} />Add</button>
        </div>
        {unaddedBank.length > 0 && (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <select value={bankPick} onChange={e => setBankPick(e.target.value)}
              style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, font: 'inherit', fontSize: 12.5 }}>
              <option value="">Add from question bank…</option>
              {unaddedBank.map(b => <option key={b.id} value={b.id}>{b.text}</option>)}
            </select>
            <button className="btn ghost tiny" onClick={addFromBank} disabled={!bankPick}><Plus size={12} />Add</button>
          </div>
        )}
      </section>

      {/* Ask AI over this job */}
      <section>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Ask AI about this job</div>
        {chat.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
            {chat.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'prep-msg-user' : 'card card-pad'}
                style={m.role === 'user'
                  ? { alignSelf: 'flex-end', maxWidth: '85%', background: 'var(--accent)', color: '#fff', padding: '8px 11px', borderRadius: 10, fontSize: 12.5 }
                  : { maxWidth: '92%', padding: 12, fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {m.content}
              </div>
            ))}
            {asking && <div className="muted" style={{ fontSize: 12 }}><Loader2 size={11} className="spin" /> Thinking…</div>}
          </div>
        )}
        <div className="row" style={{ gap: 6 }}>
          <input type="text" value={ask} onChange={e => setAsk(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onAsk() }}
            placeholder="e.g. What benefits were mentioned? How big is the team?"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, font: 'inherit', fontSize: 12.5 }} />
          <button className="btn indigo tiny" onClick={onAsk} disabled={asking || !ask.trim()}><Send size={12} />Ask</button>
        </div>
      </section>
    </div>
  )
}
