import { X, Check, Sparkles } from 'lucide-react'
import { TIER_LIMITS } from '../lib/ai'
import { useAuth } from '../hooks/useAuth'

// Order matters — drives the pricing-card layout left-to-right. "university"
// is rendered as a "Coming Soon" card; pricing is not yet wired.
const PLANS = [
  { k: 'free',       n: 'Free',       price: '$0',      period: '/forever', cta: 'Current plan', tone: 'plain' },
  { k: 'pro',        n: 'Pro',        price: '$29.99',  period: '/mo',      cta: 'Upgrade to Pro',   tone: 'accent' },
  { k: 'elite',      n: 'Elite',      price: '$44.99',  period: '/mo',      cta: 'Upgrade to Elite', tone: 'gradient' },
  { k: 'university', n: 'University', price: 'Coming soon', period: '',     cta: null,                tone: 'plain' },
]

// Feature comparison rows. The first column is the human label, the rest are
// per-tier rendered values. Order chosen to put the most "sellable" features
// (parses, scores, prep, ask AI) at the top.
const FEATURE_ROWS = [
  { feature: 'job_parses',       label: 'Job link auto-fills',  reset: 'monthly' },
  { feature: 'ats_scores',       label: 'ATS scoring',          reset: 'monthly' },
  { feature: 'interview_prep',   label: 'Interview prep',       reset: 'monthly' },
  { feature: 'ask_ai_per_day',   label: 'Ask AI questions',     reset: 'daily' },
  { feature: 'email_replies',    label: 'Email reply drafts',   reset: 'total' },
  { feature: 'resume_tailoring', label: 'Resume tailoring',     reset: 'total' },
  { feature: 'resume_versions',  label: 'Resume versions',      reset: 'active' },
  { feature: 'nudges',           label: 'Active nudges',        reset: 'active' },
  { feature: 'community_intel',  label: 'Community intel',      reset: 'monthly' },
  { feature: 'peer_comparisons', label: 'Peer comparisons',     reset: 'monthly' },
  { feature: 'job_match_score',  label: 'Job match score',      reset: 'monthly' },
]

// Render a tier_limits cell value in human terms. Never expose token counts.
function renderLimit(value) {
  if (value === -1) return <span className="upgrade-cell-unlim">Unlimited</span>
  if (value === 0)  return <span className="upgrade-cell-locked">—</span>
  return <span className="upgrade-cell-num">{value}</span>
}

export default function UpgradeModal({ feature, onClose }) {
  const { user } = useAuth()
  const currentPlan = user?.plan || 'free'

  const onUpgrade = (planKey) => {
    // Payment wiring not implemented yet — see #payments-roadmap.
    console.log(`[upgrade] user requested upgrade to ${planKey}`)
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal upgrade-modal" onClick={e => e.stopPropagation()}>
        <div className="upgrade-head">
          <div className="row" style={{ gap: 10 }}>
            <div className="upgrade-spark">
              <Sparkles size={14} />
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0 }}>Unlock more with Hired</h3>
              <p className="upgrade-sub">
                {feature && feature !== '*'
                  ? `You've hit the free limit for this feature.`
                  : `Compare plans and pick what fits your search.`}
              </p>
            </div>
            <button className="btn ghost icon" onClick={onClose} title="Close"><X size={14} /></button>
          </div>
        </div>

        <div className="upgrade-body">
          <div className="upgrade-cards">
            {PLANS.map(p => {
              const isCurrent = p.k === currentPlan
              const comingSoon = p.k === 'university'
              return (
                <div key={p.k} className={`upgrade-card tone-${p.tone} ${isCurrent ? 'current' : ''}`}>
                  <div className="upgrade-card-name">
                    {p.n}
                    {comingSoon && <span className="tag indigo" style={{ marginLeft: 6 }}>Coming Soon</span>}
                    {isCurrent && !comingSoon && <span className="tag" style={{ marginLeft: 6 }}>Current</span>}
                  </div>
                  <div className="upgrade-card-price">
                    <span className="price">{p.price}</span>
                    {p.period && <span className="period">{p.period}</span>}
                  </div>
                  {p.cta && !comingSoon && (
                    isCurrent ? (
                      <button className="btn ghost lg" disabled>{p.cta}</button>
                    ) : (
                      <button className={p.tone === 'accent' ? 'btn indigo lg' : 'btn ai lg'}
                        onClick={() => onUpgrade(p.k)}>
                        {p.cta}
                      </button>
                    )
                  )}
                  {comingSoon && (
                    <button className="btn ghost lg" disabled>Notify me</button>
                  )}
                </div>
              )
            })}
          </div>

          <div className="upgrade-table">
            <table>
              <thead>
                <tr>
                  <th>Feature</th>
                  {PLANS.map(p => <th key={p.k} className={p.k === currentPlan ? 'col-current' : ''}>{p.n}</th>)}
                </tr>
              </thead>
              <tbody>
                {FEATURE_ROWS.map(r => {
                  const highlight = feature && feature !== '*' && r.feature === feature
                  return (
                    <tr key={r.feature} className={highlight ? 'row-highlight' : ''}>
                      <td className="row-label">
                        {r.label}
                        <span className="row-reset">{
                          r.reset === 'monthly' ? '/ month' :
                          r.reset === 'daily'   ? '/ day' :
                          r.reset === 'active'  ? 'active' : 'total'
                        }</span>
                      </td>
                      {PLANS.map(p => (
                        <td key={p.k} className={p.k === currentPlan ? 'col-current' : ''}>
                          {p.k === 'university'
                            ? <span className="upgrade-cell-locked">—</span>
                            : renderLimit(TIER_LIMITS[p.k]?.[r.feature])}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                <tr>
                  <td className="row-label">Priority support</td>
                  <td><span className="upgrade-cell-locked">—</span></td>
                  <td><Check size={13} className="upgrade-check" /></td>
                  <td><Check size={13} className="upgrade-check" /></td>
                  <td><span className="upgrade-cell-locked">—</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="upgrade-foot">
            <span className="muted">Cancel anytime. No payment processing yet — buttons are wired but billing is rolling out next.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
