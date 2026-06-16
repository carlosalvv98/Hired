/**
 * @file Prep dashboard. Two jobs:
 *   1. Question bank — reusable interview questions; "standard" ones auto-apply
 *      to every job's prep.
 *   2. Per-job prep — pick a job and work its organized summary, questions, and
 *      the Ask-AI box (grounded in the whole job: JD, notes, Q&A, emails).
 *
 * The per-job panel reuses <JobPrep>, the same component shown in the tracker
 * drawer's Notes tab.
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Star, Trash2 } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import JobPrep from '../components/JobPrep'
import { useAuth } from '../hooks/useAuth'
import {
  listApplications, getApplication, listEmailsForApp,
  listQuestionBank, createQuestion, updateQuestion, deleteQuestion,
} from '../lib/api'
import toast from 'react-hot-toast'

export default function Prep() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [apps, setApps] = useState([])
  const [selectedId, setSelectedId] = useState(params.get('job') || '')
  const [job, setJob] = useState(null)
  const [emails, setEmails] = useState([])
  const [loadingJob, setLoadingJob] = useState(false)

  const [bank, setBank] = useState([])
  const [newQ, setNewQ] = useState('')

  useEffect(() => {
    listApplications().then(setApps).catch(() => {})
    listQuestionBank().then(setBank).catch(() => {})
  }, [])

  // Load the selected job (full row + emails) for the prep panel.
  useEffect(() => {
    if (!selectedId) { setJob(null); setEmails([]); return }
    let cancelled = false
    setLoadingJob(true)
    Promise.all([getApplication(selectedId), listEmailsForApp(selectedId)])
      .then(([a, em]) => { if (!cancelled) { setJob(a); setEmails(em) } })
      .catch(() => { if (!cancelled) toast.error('Could not load job') })
      .finally(() => { if (!cancelled) setLoadingJob(false) })
    return () => { cancelled = true }
  }, [selectedId])

  const pickJob = (id) => {
    setSelectedId(id)
    const next = new URLSearchParams(params)
    id ? next.set('job', id) : next.delete('job')
    setParams(next, { replace: true })
  }

  const addQuestion = async (is_standard) => {
    const text = newQ.trim()
    if (!text) return
    try {
      const row = await createQuestion({ text, is_standard: !!is_standard }, user.id)
      setBank(b => [...b, row]); setNewQ('')
    } catch { toast.error('Could not add question') }
  }

  const toggleStandard = async (q) => {
    setBank(b => b.map(x => x.id === q.id ? { ...x, is_standard: !x.is_standard } : x))
    try { await updateQuestion(q.id, { is_standard: !q.is_standard }) }
    catch { toast.error('Could not update'); listQuestionBank().then(setBank) }
  }

  const removeQuestion = async (id) => {
    setBank(b => b.filter(x => x.id !== id))
    try { await deleteQuestion(id) } catch { toast.error('Could not delete'); listQuestionBank().then(setBank) }
  }

  return (
    <>
      <AppBar title="Prep" crumbs="interview prep · question bank" />
      <PageActions
        left={
          <select value={selectedId} onChange={e => pickJob(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, minWidth: 260 }}>
            <option value="">Choose a job to prep…</option>
            {apps.map(a => (
              <option key={a.id} value={a.id}>
                {a.role_title}{a.company?.name ? ` · ${a.company.name}` : ''}
              </option>
            ))}
          </select>
        }
      />
      <div className="content">
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Question bank */}
          <div className="card card-pad" style={{ flex: '1 1 320px', minWidth: 0, maxWidth: 460 }}>
            <h3 style={{ margin: '0 0 4px' }}>Question bank</h3>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
              Star a question to make it <b>standard</b> — it'll auto-apply to every job's prep.
            </p>
            <div className="row" style={{ gap: 6, marginBottom: 12 }}>
              <input type="text" value={newQ} onChange={e => setNewQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addQuestion(false) }}
                placeholder="Add a question…"
                style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 }} />
              <button className="btn ghost tiny" onClick={() => addQuestion(false)} disabled={!newQ.trim()}><Plus size={12} />Add</button>
              <button className="btn indigo tiny" onClick={() => addQuestion(true)} disabled={!newQ.trim()} title="Add as a standard question"><Star size={12} />Standard</button>
            </div>
            {bank.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>No questions yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {bank.map(q => (
                  <div key={q.id} className="row" style={{ gap: 8, alignItems: 'center', padding: '7px 8px', border: '1px solid var(--line)', borderRadius: 8 }}>
                    <button className="btn ghost icon" title={q.is_standard ? 'Standard (applies to all jobs)' : 'Make standard'}
                      onClick={() => toggleStandard(q)}>
                      <Star size={13} fill={q.is_standard ? 'currentColor' : 'none'}
                        color={q.is_standard ? 'var(--accent)' : 'var(--ink-3)'} />
                    </button>
                    <span style={{ flex: 1, fontSize: 12.5 }}>{q.text}</span>
                    <button className="btn ghost icon" onClick={() => removeQuestion(q.id)} title="Delete"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-job prep */}
          <div style={{ flex: '2 1 480px', minWidth: 0 }}>
            {!selectedId ? (
              <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 48 }}>
                Pick a job above to organize notes, plan questions, and ask AI about it.
              </div>
            ) : loadingJob || !job ? (
              <div className="card skel" style={{ height: 240 }} />
            ) : (
              <div className="card card-pad">
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{job.role_title}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{job.company?.name || '—'}</div>
                </div>
                <JobPrep app={job} emails={emails} onAppPatched={(patch) => setJob(prev => ({ ...prev, ...patch }))} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
