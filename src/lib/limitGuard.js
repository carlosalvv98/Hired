/**
 * Limit-gate helper used at every AI call site.
 *
 * Behavior on a blocked feature:
 *   1. Always fire the toast (informs the user every time they hit the gate).
 *   2. Auto-open the UpgradeModal *once per feature*, tracked via
 *      `localStorage['hired_upgrade_shown_{feature}']`. After the first
 *      auto-open, only manual "See plans" clicks re-open the modal.
 *
 * Returns true if the call may proceed, false if it was blocked.
 *
 * Usage:
 *   if (!guardLimit({ allowed, feature, openUpgrade })) return
 *   await doTheAIcall()
 *
 * @param {object} args
 * @param {boolean} args.allowed       - from useLimit(feature).allowed
 * @param {string}  args.feature       - TIER_LIMITS key
 * @param {(f: string) => void} args.openUpgrade - from useUI()
 */
import { showLimitToast } from '../components/LimitToast'

const STORAGE_KEY = (feature) => `hired_upgrade_shown_${feature}`

export function guardLimit({ allowed, feature, openUpgrade }) {
  if (allowed) return true

  showLimitToast(feature, () => openUpgrade?.(feature))

  let alreadyShown = false
  try { alreadyShown = !!localStorage.getItem(STORAGE_KEY(feature)) } catch {}
  if (!alreadyShown) {
    try { localStorage.setItem(STORAGE_KEY(feature), '1') } catch {}
    openUpgrade?.(feature)
  }
  return false
}
