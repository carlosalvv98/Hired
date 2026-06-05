// Client-side AI-nudge generator. Runs on dashboard load: evaluates the
// user's applications / emails / calendar against a set of rules and returns
// the nudge rows to insert. De-dupes against existing nudges and respects the
// tier limit + the user's enabled types.
//
// This is intentionally deterministic (no Claude call) — fast, free, and
// recalculated every visit.

const DAY = 86_400_000

const fmtMoneyDays = (n) => Math.round(n)

// Build the list of nudge rows to create.
//   ctx = { userId, apps, emails, events, existing, prefs, remaining }
//   - existing: prior nudges (active + dismissed) for de-dupe
//   - prefs:    { [typeKey]: boolean }
//   - remaining: how many more nudges we're allowed to create (-1 = unlimited)
// Returns an array of ai_nudges insert rows.
export function generateNudges({ userId, apps = [], emails = [], events = [], existing = [], prefs = {}, remaining = -1 }) {
  if (remaining === 0) return []
  const now = Date.now()
  const idleDays = (a) => a.last_activity_at ? (now - new Date(a.last_activity_at).getTime()) / DAY : 0
  const ageDays = (iso) => iso ? (now - new Date(iso).getTime()) / DAY : 0

  // Skip a (kind, application_id) if it's already active, or was dismissed in
  // the last 14 days (don't immediately re-nag after a dismissal).
  const skip = new Set()
  for (const n of existing) {
    const key = `${n.kind}:${n.application_id || ''}`
    if (!n.dismissed_at) skip.add(key)
    else if (ageDays(n.dismissed_at) < 14) skip.add(key)
  }
  const enabled = (k) => prefs[k] !== false
  const out = []
  const push = (spec) => {
    const key = `${spec.kind}:${spec.application_id || ''}`
    if (skip.has(key)) return
    skip.add(key)
    out.push({ user_id: userId, ...spec })
  }
  const co = (a) => a.company?.name || 'this company'

  // ── Per-application rules ────────────────────────────────────────────
  for (const a of apps) {
    if (a.archived) continue

    if (enabled('confirm_applied') && a.stage === 'new' && ageDays(a.created_at) >= 5) {
      push({
        kind: 'confirm_applied', application_id: a.id,
        cta_label: 'Mark as applied',
        body_md: `${a.role_title} at ${co(a)} has sat in New for ${fmtMoneyDays(ageDays(a.created_at))} days. Did you apply?`,
        cta_action_json: { action: 'stage', to_stage: 'applied' },
      })
    }

    if (enabled('follow_up') && a.stage === 'applied' && idleDays(a) >= 14) {
      const email = emails.find(e => e.linked_application_id === a.id)
      push({
        kind: 'follow_up', application_id: a.id,
        cta_label: 'Send a follow-up',
        body_md: `You applied to ${a.role_title} at ${co(a)} ${fmtMoneyDays(idleDays(a))} days ago and haven't heard back. Send a friendly follow-up?`,
        cta_action_json: email ? { action: 'email', email_id: email.id } : { action: 'job' },
      })
    }

    if (enabled('going_stale') && ['applied', 'screen', 'iv', 'final'].includes(a.stage)
        && idleDays(a) >= 25 && idleDays(a) < 30) {
      push({
        kind: 'going_stale', application_id: a.id,
        cta_label: 'Mark as ghosted',
        body_md: `No activity on ${a.role_title} at ${co(a)} for ${fmtMoneyDays(idleDays(a))} days. It'll auto-archive soon — mark it ghosted now?`,
        cta_action_json: { action: 'stage', to_stage: 'ghost' },
      })
    }

    if (enabled('offer_deadline') && a.stage === 'offer') {
      push({
        kind: 'offer_deadline', application_id: a.id,
        cta_label: 'Review offer',
        body_md: `You have an open offer from ${co(a)} for ${a.role_title}. Don't let it expire — review and respond.`,
        cta_action_json: { action: 'job' },
      })
    }
  }

  // ── Email rules ──────────────────────────────────────────────────────
  if (enabled('reply_needed')) {
    for (const e of emails) {
      if (!e.is_unread || !e.linked_application_id) continue
      push({
        kind: 'reply_needed', application_id: e.linked_application_id,
        cta_label: 'Reply',
        body_md: `${e.from_name || e.from_email} emailed you${e.subject ? ` — "${e.subject}"` : ''} and you haven't replied yet.`,
        cta_action_json: { action: 'email', email_id: e.id },
      })
    }
  }

  // ── Calendar rules (interview prep / thank-you) ──────────────────────
  for (const ev of events) {
    const start = ev.starts_at ? new Date(ev.starts_at).getTime() : null
    if (start == null) continue
    const inDays = (start - now) / DAY
    const appId = ev.application?.id || ev.application_id || null
    const label = ev.application?.company?.name || ev.title || 'your interview'
    if (enabled('interview_prep') && inDays >= 0 && inDays <= 3) {
      push({
        kind: 'interview_prep', application_id: appId,
        cta_label: 'Prep now',
        body_md: `Interview for ${label} ${inDays < 1 ? 'today' : `in ${Math.ceil(inDays)} day${Math.ceil(inDays) === 1 ? '' : 's'}`}. Pull up your prep.`,
        cta_action_json: { action: 'job' },
      })
    }
    if (enabled('thank_you') && inDays <= -1 && inDays >= -2) {
      push({
        kind: 'thank_you', application_id: appId,
        cta_label: 'Send thank-you',
        body_md: `You interviewed with ${label} ${Math.abs(Math.floor(inDays))} day(s) ago. A quick thank-you goes a long way.`,
        cta_action_json: { action: 'job' },
      })
    }
  }

  // ── Weekly summary (once / 7 days) ───────────────────────────────────
  if (enabled('weekly_summary')) {
    const lastSummary = existing.find(n => n.kind === 'weekly_summary')
    if (!lastSummary || ageDays(lastSummary.created_at) >= 7) {
      const active = apps.filter(a => !a.archived).length
      const interviews = apps.filter(a => ['screen', 'iv', 'final'].includes(a.stage)).length
      const offers = apps.filter(a => a.stage === 'offer').length
      push({
        kind: 'weekly_summary', application_id: null,
        cta_label: 'View tracker',
        body_md: `This week: ${active} active application${active === 1 ? '' : 's'}, ${interviews} in interviews, ${offers} offer${offers === 1 ? '' : 's'}. Keep the momentum going.`,
        cta_action_json: { action: 'summary' },
      })
    }
  }

  // Respect the tier cap.
  return remaining === -1 ? out : out.slice(0, Math.max(0, remaining))
}
