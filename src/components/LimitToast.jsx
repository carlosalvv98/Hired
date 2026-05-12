import toast from 'react-hot-toast'

// Human label for each feature, so the toast and the upgrade modal speak
// the user's language (parses / scores / sessions / questions) — never
// "tokens" or other implementation jargon.
export const FEATURE_LABELS = {
  job_parses:        { unit: 'job auto-fills', period: 'this month' },
  email_parses:      { unit: 'email auto-parses', period: 'this month' },
  email_replies:     { unit: 'reply drafts', period: '' },
  ats_scores:        { unit: 'ATS scores', period: 'this month' },
  resume_tailoring:  { unit: 'resume tailorings', period: '' },
  resume_imports:    { unit: 'AI resume imports', period: '' },
  interview_prep:    { unit: 'interview prep sessions', period: 'this month' },
  ask_ai_per_day:    { unit: 'Ask AI questions', period: 'today' },
  community_intel:   { unit: 'community intel views', period: 'this month' },
  nudges:            { unit: 'active nudges', period: '' },
  peer_comparisons:  { unit: 'peer comparisons', period: 'this month' },
  job_match_score:   { unit: 'job match scores', period: 'this month' },
}

/**
 * Show the "limit hit" toast. Renders a "See plans" link that opens the
 * global UpgradeModal via `openUpgrade(feature)` from useUI.
 *
 * @param {string} feature  - one of the TIER_LIMITS keys
 * @param {() => void} onSeePlans  - usually `openUpgrade` from useUI
 */
export function showLimitToast(feature, onSeePlans) {
  const meta = FEATURE_LABELS[feature] || { unit: 'requests', period: 'this month' }
  const periodSuffix = meta.period ? ` ${meta.period}` : ''
  toast.custom((t) => (
    <div className={`limit-toast ${t.visible ? 'in' : 'out'}`}>
      <div className="limit-toast-body">
        <div className="limit-toast-title">
          You've used all your {meta.unit}{periodSuffix}.
        </div>
        <div className="limit-toast-sub">
          Upgrade to Pro for unlimited.
        </div>
      </div>
      <button className="limit-toast-cta" onClick={() => {
        toast.dismiss(t.id)
        onSeePlans?.()
      }}>
        See plans
      </button>
    </div>
  ), { duration: 4000, position: 'bottom-right' })
}
