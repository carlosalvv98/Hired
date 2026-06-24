import { useState, useEffect } from 'react'
import { Sparkles, Check, Mail, Plug, LogOut, User, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import AppBar from '../components/AppBar'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import { useStyleLearner } from '../hooks/useStyleLearner'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Settings() {
  const { profile, user, signOut, refreshProfile } = useAuth()
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (profile) {
      setName(profile.name || '')
      setHandle(profile.handle || '')
    }
  }, [profile])

  const HIRED_EMAIL = profile?.forwarding_address || `hired-${profile?.handle || 'me'}@hired.app`

  const onSave = async () => {
    setBusy(true)
    try {
      const cleanHandle = handle.toLowerCase().replace(/[^a-z0-9]/g, '')
      const { error } = await supabase.from('users').update({
        name, handle: cleanHandle,
        forwarding_address: `hired-${cleanHandle}@hired.app`,
      }).eq('id', user.id)
      if (error) throw error
      await refreshProfile(user.id)
      toast.success('Profile updated')
    } catch (e) { toast.error(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  const onCopyEmail = async () => {
    await navigator.clipboard.writeText(HIRED_EMAIL)
    toast.success('Copied')
  }

  return (
    <>
      <AppBar title="Settings" crumbs="profile · integrations" />
      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 720px)', gap: 18 }}>
          <Section title="Profile" Icon={User}>
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="field">
              <label>Handle</label>
              <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="yourhandle" />
              <small style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                Determines your forwarding address: <span className="mono">hired-{handle || '…'}@hired.app</span>
              </small>
            </div>
            <div className="field">
              <label>Email</label>
              <input value={profile?.email || ''} disabled />
            </div>
            <button className="btn primary" onClick={onSave} disabled={busy} style={{ alignSelf: 'flex-start' }}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
          </Section>

          <WritingStyleSection />

          <Section title="Hired forwarding email" Icon={Mail}>
            <div className="card spotlight" style={{ padding: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Your forwarding address</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{HIRED_EMAIL}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 8, lineHeight: 1.5 }}>
                Use this when you apply. We auto-parse every reply and update your tracker. Set up a Gmail filter to forward
                anything from <span className="mono">jobs@</span>, <span className="mono">recruiter@</span>, etc.
              </div>
              <button className="btn indigo" onClick={onCopyEmail} style={{ marginTop: 12 }}>
                <Check size={13} />Copy address
              </button>
            </div>
          </Section>

          <Section title="Integrations" Icon={Plug}>
            <Integration name="Gmail" desc="Auto-import job emails from your inbox" />
            <Integration name="Google Calendar" desc="Two-way sync interview events" />
            <Integration name="Outlook" desc="Auto-import emails from Outlook" />
          </Section>

          <Section title="Account" Icon={LogOut}>
            <button className="btn ghost" onClick={signOut} style={{ alignSelf: 'flex-start' }}>
              <LogOut size={13} />Sign out
            </button>
          </Section>
        </div>
      </div>
    </>
  )
}

function WritingStyleSection() {
  const { profile } = useAuth()
  const { openUpgrade } = useUI()
  const { styleEnabled, hasStyle, learning, learnStyle, clearStyle } = useStyleLearner()

  const updatedAt = profile?.writing_style_updated_at
  const summary = profile?.writing_style?.summary
  let lastAnalyzed = ''
  if (updatedAt) { try { lastAnalyzed = new Date(updatedAt).toLocaleDateString() } catch { lastAnalyzed = '' } }

  const onClear = async () => {
    if (!window.confirm('This will remove your learned style. You can re-analyze anytime.')) return
    await clearStyle()
  }

  return (
    <Section title="AI writing style" Icon={Sparkles}>
      {!styleEnabled ? (
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          Learn your personal writing voice so AI replies and drafts sound like you.{' '}
          <button onClick={() => openUpgrade('style_analysis')} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--accent-ink)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
            Upgrade to Pro
          </button>{' '}to unlock it.
        </div>
      ) : hasStyle ? (
        <>
          <div className="card" style={{ padding: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Your AI writing style</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.6 }}>{summary || 'Style profile saved.'}</div>
            {lastAnalyzed && (
              <div className="mono muted" style={{ fontSize: 10.5, marginTop: 8 }}>Last analyzed: {lastAnalyzed}</div>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost tiny" disabled={learning} onClick={learnStyle} title="Re-analyze your sent emails (uses 1 style credit)">
              {learning ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
              {learning ? 'Analyzing…' : 'Re-analyze'}
            </button>
            <button className="btn ghost tiny" disabled={learning} onClick={onClear}>
              <Trash2 size={12} />Clear style
            </button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          No writing style learned yet. Send a few emails and use the “Learn My Style” option in any email reply — or analyze now.
          <div style={{ marginTop: 10 }}>
            <button className="btn primary tiny" disabled={learning} onClick={learnStyle}>
              {learning ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
              {learning ? 'Analyzing your style…' : 'Learn my style'}
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

function Section({ title, Icon, children }) {
  return (
    <div className="card card-pad">
      <h3>
        <Icon size={14} /> {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  )
}

function Integration({ name, desc }) {
  const [connected, setConnected] = useState(false)
  return (
    <div className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{desc}</div>
      </div>
      <button className={connected ? 'btn ghost tiny' : 'btn primary tiny'} onClick={() => {
        setConnected(c => !c)
        toast(connected ? `${name} disconnected` : `${name} connected (mock — real OAuth needs a server)`)
      }}>
        {connected ? 'Disconnect' : 'Connect'}
      </button>
    </div>
  )
}
