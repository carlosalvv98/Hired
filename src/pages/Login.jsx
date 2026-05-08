import { useState } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

export default function Login() {
  const { user, signIn, loading } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await signIn(email, password)
    setBusy(false)
    if (error) {
      toast.error(error.message || 'Login failed')
      return
    }
    toast.success('Welcome back')
    nav('/')
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand-row">
          <div className="brand-mark">H</div>
          <div className="brand-name">Hired</div>
        </div>
        <h1>Welcome back</h1>
        <div className="sub">Sign in to your job tracker.</div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button className="btn indigo lg" type="submit" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="switch">No account? <Link to="/signup">Sign up</Link></div>
      </div>
    </div>
  )
}
