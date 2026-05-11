import { useCallback, useEffect, useState } from 'react'
import { checkLimit, trackUsage } from '../lib/ai'
import { useAuth } from './useAuth'

/**
 * Read + record AI-feature quota for the current user/tier.
 *
 * @param {string} feature  - one of the TIER_LIMITS keys (e.g. 'job_parses')
 *
 * @returns {{
 *   allowed:  boolean,    // false once limit hit (or feature locked on tier)
 *   used:     number,     // how many of the limit have been used this period
 *   limit:    number,     // -1 = unlimited, 0 = locked
 *   loading:  boolean,
 *   refresh:  () => void, // re-query after a successful AI call
 *   recordUsage: (model, inputTokens, outputTokens, applicationId?) => Promise<void>,
 * }}
 *
 * The hook fails open if the count query errors out so transient DB issues
 * don't lock the UX — matches the behavior in `ai.js#checkLimit`.
 */
export function useLimit(feature) {
  const { user, loading: authLoading } = useAuth()
  const [state, setState] = useState({ allowed: true, used: 0, limit: -1, loading: true })

  const load = useCallback(async () => {
    if (authLoading || !user?.id) return
    setState(s => ({ ...s, loading: true }))
    try {
      const { allowed, remaining, limit } = await checkLimit(user.id, feature, user.plan || 'free')
      const used = limit > 0 ? Math.max(0, limit - remaining) : 0
      setState({ allowed, used, limit, loading: false })
    } catch {
      setState({ allowed: true, used: 0, limit: -1, loading: false })
    }
  }, [user?.id, user?.plan, feature, authLoading])

  useEffect(() => { load() }, [load])

  const recordUsage = useCallback(async (model, inputTokens = 0, outputTokens = 0, applicationId = null) => {
    if (!user?.id) return
    await trackUsage(user.id, feature, model, inputTokens, outputTokens, applicationId)
    // Refresh so the next call's `allowed` reflects the new count.
    load()
  }, [user?.id, feature, load])

  return { ...state, refresh: load, recordUsage }
}
