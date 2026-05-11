import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Sparkles, Download, Check, RefreshCw, ArrowLeft } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import { getResume, updateResume, listApplications, createResumeScore, listResumeScores } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import toast from 'react-hot-toast'

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
  const { id } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const { openUpgrade } = useUI()
  const { allowed: atsAllowed, refresh: refreshAts } = useLimit('ats_scores')
  const [resume, setResume] = useState(null)
  const [content, setContent] = useState('')
  const [name, setName] = useState('')
  const [apps, setApps] = useState([])
  const [scoreAppId, setScoreAppId] = useState('')
  const [scores, setScores] = useState([])
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [r, a, s] = await Promise.all([getResume(id), listApplications(), listResumeScores(id)])
      setResume(r); setContent(r.content_md || ''); setName(r.name)
      setApps(a); setScores(s)
    } catch { toast.error('Could not load resume'); nav('/resumes') }
  }
  useEffect(() => { load() }, [id])

  const onSave = async () => {
    setBusy(true)
    try {
      await updateResume(id, { content_md: content, name })
      toast.success('Saved')
    } catch { toast.error('Save failed') }
    finally { setBusy(false) }
  }

  const onScore = async () => {
    if (!scoreAppId) { toast('Pick an application to score against'); return }
    if (!guardLimit({ allowed: atsAllowed, feature: 'ats_scores', openUpgrade })) return
    const app = apps.find(a => a.id === scoreAppId)
    if (!app) return
    const jd = [app.role_title, app.company?.name, app.jd_text || '', app.notes_md || ''].filter(Boolean).join(' ')
    const res = score(jd, content)
    try {
      await createResumeScore({
        resume_id: id, application_id: scoreAppId,
        score: res.score, breakdown_json: res, model: 'client-heuristic-v1',
      })
      // Record against the ats_scores quota. Heuristic scorer doesn't burn
      // tokens, but the count itself is what the tier limit gates on.
      if (user?.id) {
        const { trackUsage } = await import('../lib/ai')
        await trackUsage(user.id, 'ats_scores', 'client-heuristic-v1', 0, 0, scoreAppId)
        refreshAts()
      }
      const next = await listResumeScores(id)
      setScores(next)
      toast.success(`Score: ${res.score}`)
    } catch { toast.error('Could not save score') }
  }

  const latestScore = scores[0]

  const onExport = () => {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${name || 'resume'}.md`
    a.click(); URL.revokeObjectURL(url)
  }

  if (!resume) return (
    <>
      <AppBar title="Resume" crumbs="resumes / editor" />
      <div className="content"><div className="skel" style={{ height: 400 }} /></div>
    </>
  )

  return (
    <>
      <AppBar title={name || 'Resume'} crumbs="resumes / editor" />
      <PageActions right={
        <>
          <button className="btn ghost tiny" onClick={() => nav('/resumes')}><ArrowLeft size={13} />Library</button>
          <button className="btn ghost tiny" onClick={onExport}><Download size={13} />Export .md</button>
          <button className="btn primary tiny" onClick={onSave} disabled={busy}><Check size={13} />{busy ? 'Saving…' : 'Save'}</button>
        </>
      } />
      <div className="editor-wrap">
        <div className="editor-left">
          <h4>Name</h4>
          <input className="field" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
            value={name} onChange={e => setName(e.target.value)} />

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
              onChange={e => setContent(e.target.value)}
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
