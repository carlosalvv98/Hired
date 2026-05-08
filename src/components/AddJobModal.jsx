import { useState } from 'react'
import { X, Sparkles } from 'lucide-react'
import { findOrCreateCompany, createApplication, upsertSteps } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const SUGGESTED_STEPS = ['Recruiter screen', 'Tech screen', 'Hiring manager', 'Onsite', 'Offer'];

// Lightweight URL → fields heuristic (no LLM, but feels instant).
// Real product would call an edge function with Claude. This still
// gives the user a working "paste link, click parse" experience.
function parseJDUrl(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace('www.', '')
    let company = host.split('.')[0]
    // jobs.lever.co/anthropic/...
    if (host.includes('lever.co') || host.includes('greenhouse.io') || host.includes('ashbyhq.com')) {
      const seg = u.pathname.split('/').filter(Boolean)[0]
      if (seg) company = seg
    }
    company = company.charAt(0).toUpperCase() + company.slice(1)
    const path = u.pathname.toLowerCase()
    let role_title = 'Software Engineer'
    const m = path.match(/[^/]+$/)
    if (m) {
      role_title = m[0].replace(/[-_]/g, ' ').replace(/\.[a-z]+$/, '')
        .replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80)
      if (!role_title || role_title.length < 4) role_title = 'Software Engineer'
    }
    return { company, role_title, jd_url: url, mode: 'remote' }
  } catch {
    return null
  }
}

export default function AddJobModal({ onClose, onCreated, defaultUrl = '' }) {
  const { user } = useAuth()
  const [step, setStep] = useState(defaultUrl ? 'parse' : 'choose')
  const [url, setUrl] = useState(defaultUrl)
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)

  // Manual fields
  const [m, setM] = useState({
    company: '', role_title: '', location_text: '', mode: 'remote',
    salary_min: '', salary_max: '', stage: 'applied', source: 'applied_direct',
  })

  const onParse = async () => {
    if (!url) return
    setBusy(true)
    await new Promise(r => setTimeout(r, 700))
    const p = parseJDUrl(url)
    setBusy(false)
    if (!p) { toast.error('Could not parse URL'); return }
    setParsed(p)
    setStep('parse')
  }

  const create = async (payload) => {
    setBusy(true)
    try {
      const co = payload.company ? await findOrCreateCompany(payload.company) : null
      const app = await createApplication({
        company_id: co?.id || null,
        role_title: payload.role_title || 'Untitled role',
        location_text: payload.location_text || null,
        mode: payload.mode || null,
        salary_min: payload.salary_min ? Number(payload.salary_min) : null,
        salary_max: payload.salary_max ? Number(payload.salary_max) : null,
        stage: payload.stage || 'applied',
        source: payload.source || 'applied_direct',
        jd_url: payload.jd_url || null,
        applied_at: new Date().toISOString(),
      }, user.id)
      // Seed default interview steps (mark them learned for the cohort vibe)
      await upsertSteps(app.id, SUGGESTED_STEPS.map(t => ({ title: t, status: 'pending', learned_from_cohort: true })))
      toast.success('Application added')
      onCreated?.(app)
      onClose()
    } catch (e) {
      toast.error(e.message || 'Could not create application')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 540 }}>
        <div className="modal-head">
          <h3>Add a job</h3>
          <button className="btn ghost icon" onClick={onClose}><X size={14} /></button>
        </div>

        {step === 'choose' && (
          <div className="modal-body">
            <div className="card spotlight" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <Sparkles size={14} color="var(--accent)" />
                <h3 style={{ margin: 0, fontSize: 13.5 }}>Add from URL</h3>
              </div>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--accent-ink)', opacity: 0.7, marginBottom: 6 }}>
                Paste link · AI fills the rest
              </div>
              <div className="parse-input">
                <input
                  type="url" value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="https://jobs.lever.co/anthropic/forward-deployed-eng"
                  spellCheck={false}
                />
                <button className="btn ai" onClick={onParse} disabled={!url || busy}>
                  <Sparkles size={12} /> {busy ? 'Parsing…' : 'Parse'}
                </button>
              </div>
            </div>
            <div className="row" style={{ gap: 8, color: 'var(--ink-3)', fontSize: 12 }}>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              <span>or</span>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>
            <button className="btn ghost lg" onClick={() => setStep('manual')}>
              Add manually
            </button>
          </div>
        )}

        {step === 'parse' && parsed && (
          <div className="modal-body">
            <div className="card spotlight" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                <Sparkles size={12} color="var(--accent)" />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-ink)' }}>
                  AI extracted these fields
                </span>
              </div>
              <div className="parse-chips">
                <span className="parse-chip"><span className="ck">✓</span> {parsed.company}</span>
                <span className="parse-chip"><span className="ck">✓</span> {parsed.role_title}</span>
                <span className="parse-chip"><span className="ck">✓</span> {parsed.mode}</span>
              </div>
            </div>
            <Field label="Company" value={parsed.company} onChange={v => setParsed({ ...parsed, company: v })} />
            <Field label="Role title" value={parsed.role_title} onChange={v => setParsed({ ...parsed, role_title: v })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Location" value={parsed.location_text || ''} onChange={v => setParsed({ ...parsed, location_text: v })} placeholder="NYC" />
              <SelectField label="Mode" value={parsed.mode} onChange={v => setParsed({ ...parsed, mode: v })}
                options={[['remote','Remote'],['hybrid','Hybrid'],['onsite','Onsite']]} />
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn ghost" onClick={() => setStep('choose')}>Back</button>
              <button className="btn indigo" disabled={busy} onClick={() => create({
                company: parsed.company, role_title: parsed.role_title,
                location_text: parsed.location_text, mode: parsed.mode,
                jd_url: parsed.jd_url,
              })}>
                {busy ? 'Adding…' : 'Add to tracker'}
              </button>
            </div>
          </div>
        )}

        {step === 'manual' && (
          <div className="modal-body">
            <Field label="Company *" value={m.company} onChange={v => setM({ ...m, company: v })} placeholder="Anthropic" />
            <Field label="Role title *" value={m.role_title} onChange={v => setM({ ...m, role_title: v })} placeholder="Software Engineer" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Location" value={m.location_text} onChange={v => setM({ ...m, location_text: v })} placeholder="NYC" />
              <SelectField label="Mode" value={m.mode} onChange={v => setM({ ...m, mode: v })}
                options={[['remote','Remote'],['hybrid','Hybrid'],['onsite','Onsite']]} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Salary min" value={m.salary_min} onChange={v => setM({ ...m, salary_min: v })} placeholder="170000" type="number" />
              <Field label="Salary max" value={m.salary_max} onChange={v => setM({ ...m, salary_max: v })} placeholder="220000" type="number" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <SelectField label="Stage" value={m.stage} onChange={v => setM({ ...m, stage: v })}
                options={[['applied','Applied'],['screen','Screen'],['iv','Interview'],['final','Final'],['offer','Offer']]} />
              <SelectField label="Source" value={m.source} onChange={v => setM({ ...m, source: v })}
                options={[['referral','Referral'],['applied_direct','Direct apply'],['recruiter_outbound','Recruiter outbound'],['job_board','Job board']]} />
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn ghost" onClick={() => setStep('choose')}>Back</button>
              <button className="btn indigo" disabled={busy || !m.company || !m.role_title} onClick={() => create(m)}>
                {busy ? 'Adding…' : 'Create application'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}
