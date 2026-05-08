import { useState } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

export default function Signup() {
  const { user, signUp, loading } = useAuth()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setBusy(true)
    const { data, error } = await signUp(email, password, name)
    setBusy(false)
    if (error) {
      toast.error(error.message || 'Sign up failed')
      return
    }
    if (!data.session) {
      toast.success('Check your email to confirm your account')
      return
    }
    toast.success('Account created')
    nav('/')
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand-row">
          <div className="brand-mark">H</div>
          <div className="brand-name">Hired</div>
        </div>
        <h1>Create account</h1>
        <div className="sub">Track every job application in one place.</div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>Name</label>
            <input type="text" required value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={6} />
          </div>
          <button className="btn indigo lg" type="submit" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <div className="switch">Already have an account? <Link to="/login">Sign in</Link></div>
      </div>
    </div>
  )
}
