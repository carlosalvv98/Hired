import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from './useAuth'
import { useUI } from './useUI'
import { useLimit } from './useLimit'
import { guardLimit } from '../lib/limitGuard'
import { trackUsage } from '../lib/ai'
import { analyzeWritingStyle, countSentEmails, MIN_STYLE_EMAILS } from '../lib/agents/styleAnalyzer'
import { saveWritingStyle } from '../lib/api'

/**
 * Shared writing-style controller used by EmailReplies, OutboundDraft, and
 * Settings. Encapsulates the premium gate, the 5-email minimum, the quota
 * check, the Sonnet analysis, persistence, and profile refresh.
 *
 * @returns {{
 *   styleEnabled: boolean,  // Pro/Elite only — free tier never sees the pills
 *   hasStyle: boolean,      // a learned profile exists
 *   style: object|null,
 *   learning: boolean,
 *   learnStyle: () => Promise<boolean>,  // analyze + save (also used for re-analyze)
 *   clearStyle: () => Promise<void>,
 * }}
 */
export function useStyleLearner() {
  const { user, refreshProfile } = useAuth()
  const { openUpgrade } = useUI()
  const { allowed, refresh } = useLimit('style_analysis')
  const [learning, setLearning] = useState(false)

  const plan = user?.plan || 'free'
  const styleEnabled = plan === 'pro' || plan === 'elite'
  const style = user?.writing_style || null
  const hasStyle = !!style

  const learnStyle = async () => {
    if (learning || !user?.id) return false

    // 1. Minimum sent emails (cheap count first, before spending a credit).
    let count = 0
    try { count = await countSentEmails(user.id) } catch { /* fall through */ }
    if (count < MIN_STYLE_EMAILS) {
      toast(`Send at least ${MIN_STYLE_EMAILS} emails first so the AI can learn your style`)
      return false
    }

    // 2. Quota gate (Sonnet is expensive).
    if (!guardLimit({ allowed, feature: 'style_analysis', openUpgrade })) return false

    // 3. Analyze + persist.
    setLearning(true)
    try {
      const { style: profile, _usage } = await analyzeWritingStyle(user.id)
      await saveWritingStyle(user.id, profile)
      await trackUsage(user.id, 'style_analysis', _usage.model, _usage.inputTokens, _usage.outputTokens)
      await refreshProfile(user.id)
      refresh()
      toast.success("Writing style learned! Your 'My Style' pill is now active")
      return true
    } catch (e) {
      toast.error(e?.message || 'Could not analyze your writing style')
      return false
    } finally {
      setLearning(false)
    }
  }

  const clearStyle = async () => {
    if (!user?.id) return
    try {
      await saveWritingStyle(user.id, null)
      await refreshProfile(user.id)
      toast.success('Writing style cleared')
    } catch {
      toast.error('Could not clear style')
    }
  }

  return { styleEnabled, hasStyle, style, learning, learnStyle, clearStyle }
}
