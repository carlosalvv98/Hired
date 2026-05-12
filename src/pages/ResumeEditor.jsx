import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Sparkles, Check, RefreshCw, ArrowLeft } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import {
  getResume, updateResume, listApplications, createResumeScore, listResumeScores,
  createResume,
} from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import toast from 'react-hot-toast'

const STARTER_NAME = 'Untitled resume'
const STARTER_CONTENT = ''

// Lightweight client-side ATS heuristic — counts unique keyword overlap
// between the JD and the resume. Not a substitute for a real model, but it
// gives a real, deterministic score the user can iterate against.
const STOP = new Set(['the','a','an','and','or','of','to','in','for','with','on','at','by','as','is','are','was','were','be','been','have','has','had','this','that','it','from','your','you','our','we','us','will'])
function score(jdText, resumeText) {
  const norm = (t) => (t || '').toLowerCase().replace(/[^\w\s+#./-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
  const jd = new Set(norm(jdText))
  const rs = new Set(norm(resumeText))
  if (!jd.size || !rs.size) return { score: 0, matched: [], missing: [] }
  const matched = [...jd].filter(w => rs.has(w))
  const missing = [...jd].filter(w => !rs.has(w)).slice(0, 12)
  const s = Math.min(100, Math.round((matched.length / jd.size) * 130))
  return { score: s, matched: matched.slice(0, 20), missing }
}

export default function ResumeEditor() {
  const { id: routeId } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const { openUpgrade } = useUI()
  const { allowed: atsAllowed, refresh: refreshAts } = useLimit('ats_scores')

  // `routeId === 'new'` is the draft state. We hold a local copy of the
  // resume in memory and don't insert a DB row until the user actually
  // edits something — clicking "New" alone shouldn't litter the library.
  const isDraft = routeId === 'new'
  const [actualId, setActualId] = useState(isDraft ? null : routeId)
  const [resume, setResume] = useState(isDraft ? { id: null, name: STARTER_NAME, content_md: STARTER_CONTENT } : null)
  const [content, setContent] = useState(STARTER_CONTENT)
  const [name, setName] = useState(STARTER_NAME)
  const [apps, setApps] = useState([])
  const [scoreAppId, setScoreAppId] = useState('')
  const [scores, setScores] = useState([])
  const [busy, setBusy] = useState(false)
  // Tracks whether the user has actually edited anything yet. Autosave
  // and the initial DB insert both gate on this — clicking "New" without
  // typing should be a no-op.
  const [dirty, setDirty] = useState(false)
  const [savingState, setSavingState] = useState('idle') // 'idle' | 'saving' | 'saved'

  const load = async () => {
    try {
      const [r, a, s] = await Promise.all([
        getResume(routeId), listApplications(), listResumeScores(routeId),
      ])
      setResume(r); setContent(r.content_md || ''); setName(r.name)
      setApps(a); setScores(s)
      setActualId(routeId)
    } catch { toast.error('Could not load resume'); nav('/resumes') }
  }

  useEffect(() => {
    if (isDraft) {
      // Still load the applications list so ATS scoring works once saved.
      listApplications().then(setApps).catch(() => {})
      return
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  // Persist the current draft. Creates the DB row on first save, then
  // updates it from there. Called both from the manual Save button and
  // the debounced autosave below.
  const persist = async () => {
    if (!dirty) return
    setBusy(true)
    setSavingState('saving')
    try {
      if (!actualId) {
        const r = await createResume({
          name: name || STARTER_NAME,
          version: 'v1',
          content_md: content,
          source: 'manual',
        }, user.id)
        setActualId(r.id)
        setResume(r)
        // Replace the URL so refresh / back-button hit the real row.
        nav(`/resumes/${r.id}`, { replace: true })
      } else {
        await updateResume(actualId, { content_md: content, name })
      }
      setSavingState('saved')
      setDirty(false)
      // Drop the "Saved" indicator after a beat.
      setTimeout(() => setSavingState(s => s === 'saved' ? 'idle' : s), 1500)
    } catch {
      toast.error('Save failed')
      setSavingState('idle')
    } finally { setBusy(false) }
  }

  // Debounced autosave — fires ~900ms after the user stops typing. Only
  // runs when `dirty`, so navigation + initial mount don't trigger writes.
  const autosaveTimer = useRef(null)
  useEffect(() => {
    if (!dirty) return
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => { persist() }, 900)
    return () => clearTimeout(autosaveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, name, dirty])

  const onChangeContent = (v) => { setContent(v); setDirty(true) }
  const onChangeName = (v) => { setName(v); setDirty(true) }
  const onSave = persist

  const onScore = async () => {
    if (!scoreAppId) { toast('Pick an application to score against'); return }
    if (!actualId) { toast('Save the resume first'); return }
    if (!guardLimit({ allowed: atsAllowed, feature: 'ats_scores', openUpgrade })) return
    const app = apps.find(a => a.id === scoreAppId)
    if (!app) return
    const jd = [app.role_title, app.company?.name, app.jd_text || '', app.notes_md || ''].filter(Boolean).join(' ')
    const res = score(jd, content)
    try {
      await createResumeScore({
        resume_id: actualId, application_id: scoreAppId,
        score: res.score, breakdown_json: res, model: 'client-heuristic-v1',
      })
      // Record against the ats_scores quota. Heuristic scorer doesn't burn
      // tokens, but the count itself is what the tier limit gates on.
      if (user?.id) {
        const { trackUsage } = await import('../lib/ai')
        await trackUsage(user.id, 'ats_scores', 'client-heuristic-v1', 0, 0, scoreAppId)
        refreshAts()
      }
      const next = await listResumeScores(actualId)
      setScores(next)
      toast.success(`Score: ${res.score}`)
    } catch { toast.error('Could not save score') }
  }

  const latestScore = scores[0]

  if (!resume) return (
    <>
      <AppBar title="Resume" crumbs="resumes / editor" />
      <div className="content"><div className="skel" style={{ height: 400 }} /></div>
    </>
  )

  return (
    <>
      <AppBar title={name || 'Resume'} crumbs="resumes / editor" />
      <PageActions
        left={
          <span className="autosave-indicator" data-state={savingState}>
            {savingState === 'saving' && 'Saving…'}
            {savingState === 'saved'  && 'Saved'}
            {savingState === 'idle'   && (dirty ? 'Unsaved changes' : '')}
          </span>
        }
        right={
          <>
            <button className="btn ghost tiny" onClick={() => nav('/resumes')}><ArrowLeft size={13} />Library</button>
            <button className="btn primary tiny" onClick={onSave} disabled={busy || !dirty}>
              <Check size={13} />{busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      />
      <div className="editor-wrap">
        <div className="editor-left">
          <h4>Name</h4>
          <input className="field" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
            value={name} onChange={e => onChangeName(e.target.value)} />

          <h4>ATS Score</h4>
          <div className="card" style={{ padding: 12 }}>
            <select value={scoreAppId} onChange={e => setScoreAppId(e.target.value)} style={{ width: '100%', padding: 6, border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>
              <option value="">Score against application…</option>
              {apps.map(a => <option key={a.id} value={a.id}>{a.company?.name} · {a.role_title}</option>)}
            </select>
            <button className="btn ai" style={{ width: '100%' }} onClick={onScore} disabled={!scoreAppId}>
              <Sparkles size={13} />Run ATS check
            </button>
            {latestScore && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.025em' }}>{latestScore.score}</div>
                  <div className="delta good" style={{ fontSize: 10 }}>latest</div>
                </div>
                <div style={{ height: 4, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden', marginTop: 8 }}>
                  <div style={{ width: `${latestScore.score}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--good))' }} />
                </div>
                {latestScore.breakdown_json?.missing?.length ? (
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                    Missing keywords: <span className="mono" style={{ color: 'var(--bad)' }}>{latestScore.breakdown_json.missing.slice(0, 6).join(' · ')}</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <h4>History</h4>
          {scores.length === 0 ? (
            <div className="muted" style={{ fontSize: 11 }}>No scores yet.</div>
          ) : scores.map(s => (
            <div key={s.id} className="card" style={{ padding: 10, marginBottom: 6, fontSize: 11.5 }}>
              <div className="row">
                <span style={{ fontWeight: 600 }}>{s.application?.company?.name || '—'}</span>
                <span style={{ flex: 1 }} />
                <span className="mono" style={{ color: 'var(--ink-2)' }}>{s.score}</span>
              </div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{s.application?.role_title || ''}</div>
            </div>
          ))}
        </div>

        <div className="editor-right">
          <div className="resume-paper">
            <textarea
              value={content}
              onChange={e => onChangeContent(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%', minHeight: 600, border: 'none', outline: 'none',
                resize: 'vertical', fontSize: 13, lineHeight: 1.7,
                fontFamily: 'var(--mono)', color: 'var(--ink)', background: 'transparent',
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}
