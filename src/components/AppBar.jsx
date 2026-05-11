import { Search, Bell, Sparkles } from 'lucide-react'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import toast from 'react-hot-toast'

/**
 * Top-of-page header. The right side is always the same across the app —
 * global Search, Notifications, and Ask AI — so it stays predictable as
 * the user moves between pages. Per-page actions belong in <PageActions>
 * which renders directly below the AppBar.
 *
 * @param {string} title  - page title shown on the left
 * @param {string} [crumbs] - mono breadcrumb after the title
 */
export default function AppBar({ title, crumbs }) {
  const { setCmdK, openUpgrade } = useUI()
  const { allowed: askAllowed } = useLimit('ask_ai_per_day')

  const onAskAI = () => {
    if (!guardLimit({ allowed: askAllowed, feature: 'ask_ai_per_day', openUpgrade })) return
    setCmdK(true)
  }

  return (
    <div className="appbar">
      <h1>{title}</h1>
      {crumbs && <span className="crumbs">/ {crumbs}</span>}
      <span className="spacer" />
      <div className="search" onClick={() => setCmdK(true)}>
        <Search size={14} strokeWidth={1.6} />
        <span>Search apps, contacts, emails…</span>
        <span className="kbd">⌘K</span>
      </div>
      <button className="btn ghost icon" title="Notifications" onClick={() => toast('No new notifications')}>
        <Bell size={14} strokeWidth={1.6} />
      </button>
      <button className="btn ai tiny" onClick={onAskAI}>
        <Sparkles size={13} strokeWidth={1.6} />
        Ask AI
      </button>
    </div>
  )
}

/**
 * Strip rendered directly below the AppBar for page-specific actions
 * (Today / navigation buttons in Calendar, Parsed/Raw toggle in Inbox,
 * Add / view toggles in Tracker, etc.). Keeps the global header clean.
 *
 * Use the `left` slot for filters/segmented controls anchored to the
 * start, and `right` for primary actions.
 */
export function PageActions({ left, right, children }) {
  return (
    <div className="page-actions">
      {left}
      {children}
      {(left || children) && <span style={{ flex: 1 }} />}
      {right}
    </div>
  )
}
