import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getUserProfile } from '../lib/api'
import { seedIfEmpty } from '../lib/seed'

const AuthCtx = createContext({ user: null, profile: null, loading: true })

export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = async (id) => {
    if (!id) { setProfile(null); return }
    const p = await getUserProfile(id)
    setProfile(p)
    // Seed demo data on first sign-in (idempotent)
    if (id) seedIfEmpty(id).catch(err => console.warn('seed failed', err))
  }

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setAuthUser(data.session?.user || null)
      refreshProfile(data.session?.user?.id).finally(() => setLoading(false))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthUser(session?.user || null)
      refreshProfile(session?.user?.id)
    })
    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [])

  // Merge the public.users plan onto the auth user so consumers can read
  // user.plan without separately reaching into profile. Defaults to 'free'
  // when the profile row hasn't loaded yet — keeps gating safe-by-default.
  const user = useMemo(() => {
    if (!authUser) return null
    return {
      ...authUser,
      plan: profile?.plan || 'free',
      writing_style: profile?.writing_style || null,
      writing_style_updated_at: profile?.writing_style_updated_at || null,
    }
  }, [authUser, profile])

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const signUp = (email, password, name) => supabase.auth.signUp({
    email, password, options: { data: { name } }
  })
  const signOut = () => supabase.auth.signOut()

  return (
    <AuthCtx.Provider value={{ user, profile, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
