/**
 * @file Add Job modal: paste a link (AI auto-fills) or manual entry.
 *
 * "Auto-fill" path: calls `parseJobFromUrl()` which fetches the page through
 * the Supabase edge function and asks Claude Haiku to extract structured
 * fields. On failure we toast and fall through to manual entry so the user
 * is never stranded.
 */
import { useState, useEffect } from 'react'
import { X, Sparkles, Loader2 } from 'lucide-react'
import { findOrCreateCompany, createApplication, upsertSteps } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { parseJobFromUrl } from '../lib/agents/jobParser'
import { trackUsage } from '../lib/ai'
import { guardLimit } from '../lib/limitGuard'
import { STAGES } from '../lib/stages'
import toast from 'react-hot-toast'

// Default step ladder shown on every new application. Reorderable in the drawer.
const DEFAULT_STEPS = ['Recruiter Screen', 'Interview 1', 'Interview 2', 'Final Interview', 'Offer']

export default function AddJobModal({ onClose, onCreated, defaultUrl = '' }) {
  const { user } = useAuth()
  const { openUpgrade } = useUI()
  const { allowed: parsesAllowed, refresh: refreshLimit } = useLimit('job_parses')
  // If a URL was pre-supplied from the dashboard, jump straight into autofill —
  // don't re-prompt the user for the same URL we already have.
  const [step, setStep] = useState(defaultUrl ? 'loading' : 'choose')
  const [url, setUrl] = useState(defaultUrl)
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [filling, setFilling] = useState(false)

  useEffect(() => {
    if (defaultUrl) onAutofill(defaultUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Manual fields — default stage is 'new' (saved, not yet applied to).
  const [m, setM] = useState({
    company: '', role_title: '', location_text: '', mode: 'remote',
    salary_min: null, salary_max: null, salary_type: 'base',
    ote_min: null, ote_max: null, equity_text: '',
    stage: 'new', source: '',
  })

  const onAutofill = async (overrideUrl) => {
    const target = (overrideUrl ?? url).trim()
    if (!target || filling) return
    // Block at the free-tier limit before spending a Claude call. Falls
    // back to manual entry so the user can still capture the job.
    if (!guardLimit({ allowed: parsesAllowed, feature: 'job_parses', openUpgrade })) {
      setStep('manual')
      return
    }
    setFilling(true)
    setStep('loading')
    try {
      const result = await parseJobFromUrl(target)
      if (user?.id && result._usage) {
        await trackUsage(user.id, 'job_parses', result._usage.model, result._usage.inputTokens, result._usage.outputTokens)
        refreshLimit()
      }
      setParsed(result)
      setStep('review')
    } catch (err) {
      toast.error(err.message || "Couldn't read that page — fill in the details below.")
      // Fall back to manual entry so the user is never stranded.
      setStep('manual')
    } finally {
      setFilling(false)
    }
  }

  const create = async (payload) => {
    setBusy(true)
    try {
      const co = payload.company ? await findOrCreateCompany(payload.company) : null
      const num = (v) => (v == null || v === '' ? null : Number(v))
      // Saving from a link doesn't mean you've applied — start as 'new' unless
      // the user explicitly chose otherwise in the manual form.
      const stage = payload.stage || 'new'
      const hasApplied = !['new'].includes(stage)
      const app = await createApplication({
        company_id: co?.id || null,
        role_title: payload.role_title || 'Untitled role',
        location_text: payload.location_text || null,
        mode: payload.mode || null,
        salary_min: num(payload.salary_min),
        salary_max: num(payload.salary_max),
        salary_currency: payload.salary_currency || 'USD',
        salary_type: payload.salary_type || null,
        ote_min: num(payload.ote_min),
        ote_max: num(payload.ote_max),
        equity_text: payload.equity_text || null,
        stage,
        source: payload.source || null,
        jd_url: payload.jd_url || null,
        // Persist the JD summaries into jd_text so they show in the drawer
        // and prep agents can read them.
        jd_text: [payload.jd_summary_company, payload.jd_summary_role].filter(Boolean).join('\n\n') || null,
        applied_at: hasApplied ? new Date().toISOString() : null,
      }, user.id)
      await upsertSteps(app.id, DEFAULT_STEPS.map(t => ({ title: t, status: 'pending', learned_from_cohort: false })))
      toast.success('Job added')
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

        {step === 'loading' && (
          <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center', padding: '36px 22px' }}>
            <div style={{
              width: 44, height: 44,
              background: 'linear-gradient(135deg, var(--accent), #a78bfa)',
              borderRadius: 11, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 14,
            }}>
              <Loader2 size={20} className="spin" />
            </div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Reading the listing…</h3>
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: '6px 0 0', lineHeight: 1.5 }}>
              Fetching the page and pulling out the company, role, location, and
              salary. Takes about 5 seconds.
            </p>
            <p className="mono muted" style={{ fontSize: 10.5, marginTop: 10, wordBreak: 'break-all', maxWidth: 380 }}>
              {url}
            </p>
          </div>
        )}

        {step === 'choose' && (
          <div className="modal-body">
            <div className="card spotlight" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <Sparkles size={14} color="var(--accent)" />
                <h3 style={{ margin: 0, fontSize: 13.5 }}>Auto-fill from a link</h3>
              </div>
              <div className="eyebrow" style={{ fontSize: 10, color: 'var(--accent-ink)', opacity: 0.7, marginBottom: 6 }}>
                Paste any job URL · we'll pull in the details
              </div>
              <div className="parse-input">
                <input
                  type="url" value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="https://jobs.lever.co/anthropic/forward-deployed-eng"
                  spellCheck={false}
                  disabled={filling}
                />
                <button className="btn ai" onClick={() => onAutofill()} disabled={!url || filling}>
                  {filling ? <><Loader2 size={12} className="spin" /> Reading…</> : <><Sparkles size={12} /> Auto-fill</>}
                </button>
              </div>
              {filling && (
                <div className="eyebrow" style={{ fontSize: 10, marginTop: 8, color: 'var(--accent-ink)' }}>
                  Fetching the page and pulling out the details…
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 8, color: 'var(--ink-3)', fontSize: 12 }}>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              <span>or</span>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>
            <button className="btn ghost lg" onClick={() => setStep('manual')} disabled={filling}>
              Add manually
            </button>
          </div>
        )}

        {step === 'review' && parsed && (
          <div className="modal-body">
            <div className="card spotlight" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                <Sparkles size={12} color="var(--accent)" />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-ink)' }}>
                  Here's what we pulled in
                </span>
              </div>
              <div className="parse-chips">
                <Chip ok={!!parsed.company} label={parsed.company || 'company unknown'} />
                <Chip ok={!!parsed.role_title} label={parsed.role_title || 'role unknown'} />
                <Chip ok={!!parsed.location_text} label={parsed.location_text || 'location not listed'} />
                <Chip
                  ok={parsed.salary_min != null || parsed.salary_max != null}
                  label={
                    parsed.salary_min || parsed.salary_max
                      ? `${parsed.salary_currency || 'USD'} ${formatSalaryRange(parsed.salary_min, parsed.salary_max)}`
                      : 'salary not listed'
                  }
                />
                <Chip ok={!!parsed.mode} label={parsed.mode || 'mode unknown'} />
              </div>
            </div>
            <Field label="Company" value={parsed.company || ''} onChange={v => setParsed({ ...parsed, company: v })} />
            <Field label="Role title" value={parsed.role_title || ''} onChange={v => setParsed({ ...parsed, role_title: v })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Location" value={parsed.location_text || ''} onChange={v => setParsed({ ...parsed, location_text: v })} placeholder="NYC" />
              <SelectField label="Mode" value={parsed.mode || ''} onChange={v => setParsed({ ...parsed, mode: v })}
                options={[['','—'],['remote','Remote'],['hybrid','Hybrid'],['onsite','Onsite']]} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <MoneyField label="Base salary min" value={parsed.salary_min} onChange={v => setParsed({ ...parsed, salary_min: v })} />
              <MoneyField label="Base salary max" value={parsed.salary_max} onChange={v => setParsed({ ...parsed, salary_max: v })} />
              <SelectField label="Type" value={parsed.salary_type || 'base'} onChange={v => setParsed({ ...parsed, salary_type: v })}
                options={[['base','Base'],['ote','OTE'],['base+ote','Base + OTE']]} />
            </div>
            {(parsed.salary_type === 'ote' || parsed.salary_type === 'base+ote') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <MoneyField label="OTE min" value={parsed.ote_min} onChange={v => setParsed({ ...parsed, ote_min: v })} />
                <MoneyField label="OTE max" value={parsed.ote_max} onChange={v => setParsed({ ...parsed, ote_max: v })} />
              </div>
            )}
            <Field label="Equity" value={parsed.equity_text || ''} onChange={v => setParsed({ ...parsed, equity_text: v })} placeholder="e.g. 0.1% equity or $50k RSUs" />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn ghost" onClick={() => setStep('choose')}>Back</button>
              <button className="btn indigo" disabled={busy} onClick={() => create({
                company: parsed.company,
                role_title: parsed.role_title,
                location_text: parsed.location_text,
                mode: parsed.mode,
                salary_min: parsed.salary_min,
                salary_max: parsed.salary_max,
                salary_currency: parsed.salary_currency,
                salary_type: parsed.salary_type,
                ote_min: parsed.ote_min,
                ote_max: parsed.ote_max,
                equity_text: parsed.equity_text,
                jd_url: parsed.jd_url || url,
                jd_summary_company: parsed.jd_summary_company,
                jd_summary_role: parsed.jd_summary_role,
                stage: 'new',
                source: null,
              })}>
                {busy ? 'Saving…' : 'Save to tracker'}
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <MoneyField label="Base salary min" value={m.salary_min} onChange={v => setM({ ...m, salary_min: v })} />
              <MoneyField label="Base salary max" value={m.salary_max} onChange={v => setM({ ...m, salary_max: v })} />
              <SelectField label="Type" value={m.salary_type || 'base'} onChange={v => setM({ ...m, salary_type: v })}
                options={[['base','Base'],['ote','OTE'],['base+ote','Base + OTE']]} />
            </div>
            {(m.salary_type === 'ote' || m.salary_type === 'base+ote') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <MoneyField label="OTE min" value={m.ote_min} onChange={v => setM({ ...m, ote_min: v })} />
                <MoneyField label="OTE max" value={m.ote_max} onChange={v => setM({ ...m, ote_max: v })} />
              </div>
            )}
            <Field label="Equity" value={m.equity_text || ''} onChange={v => setM({ ...m, equity_text: v })} placeholder="e.g. 0.1% equity or $50k RSUs" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <SelectField label="Status" value={m.stage} onChange={v => setM({ ...m, stage: v })}
                options={STAGES.map(s => [s.k, s.n])} />
              <SelectField label="Source" value={m.source} onChange={v => setM({ ...m, source: v })}
                options={[['','—'],['referral','Referral'],['applied_direct','Direct apply'],['recruiter_outbound','Recruiter outbound'],['job_board','Job board'],['network','Network']]} />
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn ghost" onClick={() => setStep('choose')}>Back</button>
              <button className="btn indigo" disabled={busy || !m.company || !m.role_title} onClick={() => create(m)}>
                {busy ? 'Saving…' : 'Save to tracker'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Chip({ ok, label }) {
  return (
    <span className={`parse-chip ${ok ? '' : 'pending'}`}>
      <span className="ck">{ok ? '✓' : '·'}</span> {label}
    </span>
  )
}

function formatSalaryRange(min, max) {
  const k = (n) => Math.round(n / 1000) + 'k'
  if (min && max) return `${k(min)}–${k(max)}`
  if (min || max) return `${k(min || max)}+`
  return 'not listed'
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

// Money input: displays "$130,000" while the user types and emits the
// raw number (or null when empty) via onChange. Strips $ and commas on
// every keystroke so paste-and-edit just works.
function MoneyField({ label, value, onChange, placeholder = 'not listed' }) {
  const display = value == null || value === '' ? '' : `$${Number(value).toLocaleString('en-US')}`
  const handle = (s) => {
    const raw = s.replace(/[^\d.]/g, '')
    if (!raw) return onChange(null)
    const n = Number(raw)
    onChange(Number.isFinite(n) ? n : null)
  }
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" inputMode="numeric" value={display} onChange={e => handle(e.target.value)} placeholder={placeholder} />
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
