// The catalog of AI nudge types. Drives the Configure modal, the free-tier
// upsell list, and the client-side generation engine.
//
// `action` determines what clicking the nudge does:
//   email   → open the email drawer (cta_action_json.email_id)
//   stage   → auto-move the application's stage, then open the job drawer
//   job     → open the job's side drawer
//   summary → go to the tracker
//
// NOTE: a "Tailor resume to this job" nudge is intentionally NOT here yet —
// it's bundled with the larger resume rollout that comes later.

export const NUDGE_GROUPS = {
  replies:    'Follow-ups & replies',
  interviews: 'Interviews & offers',
  hygiene:    'Pipeline hygiene',
  summary:    'Weekly summary',
}

export const NUDGE_TYPES = [
  { key: 'follow_up',       group: 'replies',    action: 'email', label: 'Follow-ups',       desc: 'Nudge to follow up when an application goes quiet for 2+ weeks.' },
  { key: 'reply_needed',    group: 'replies',    action: 'email', label: 'Reply reminders',  desc: "Reminds you to reply to recruiter/company emails you haven't answered." },
  { key: 'thank_you',       group: 'replies',    action: 'job',   label: 'Thank-you notes',  desc: 'Reminds you to send a thank-you after an interview.' },
  { key: 'interview_prep',  group: 'interviews', action: 'job',   label: 'Interview prep',   desc: 'Heads-up to prep when an interview is coming up.' },
  { key: 'offer_deadline',  group: 'interviews', action: 'job',   label: 'Offer deadlines',  desc: 'Alerts you before an offer expires.' },
  { key: 'confirm_applied', group: 'hygiene',    action: 'stage', toStage: 'applied', label: 'Confirm applied', desc: "Reminds you to mark a saved job as applied." },
  { key: 'going_stale',     group: 'hygiene',    action: 'stage', toStage: 'ghost',   label: 'Going stale',     desc: 'Warns you before a quiet application gets auto-ghosted.' },
  { key: 'weekly_summary',  group: 'summary',    action: 'summary', label: 'Weekly summary', desc: 'A weekly recap of your search progress.' },
]

export const NUDGE_TYPE_MAP = Object.fromEntries(NUDGE_TYPES.map(t => [t.key, t]))

// Default: every type enabled until the user customizes in the Configure modal.
export function defaultNudgePrefs() {
  return Object.fromEntries(NUDGE_TYPES.map(t => [t.key, true]))
}

// Merge stored prefs over defaults so a newly-added type defaults to on.
export function resolveNudgePrefs(prefs) {
  return { ...defaultNudgePrefs(), ...(prefs || {}) }
}
