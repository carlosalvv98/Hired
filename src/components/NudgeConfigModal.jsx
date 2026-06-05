import { useState } from 'react'
import { X, Sparkles, Lock } from 'lucide-react'
import { NUDGE_TYPES, NUDGE_GROUPS, resolveNudgePrefs } from '../lib/nudgeTypes'
import { updateUser } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import toast from 'react-hot-toast'

// Configure which AI-nudge types you want. On free tier the modal is `locked`:
// the catalog is shown read-only with an upgrade CTA (this is the upsell the
// free "Configure AI Nudges" button opens).
export default function NudgeConfigModal({ locked = false, onClose, onSaved }) {
  const { user, profile, refreshProfile } = useAuth()
  const { openUpgrade } = useUI()
  const [prefs, setPrefs] = useState(() => resolveNudgePrefs(profile?.nudge_prefs))
  const [saving, setSaving] = useState(false)

  const toggle = (key) => setPrefs(p => ({ ...p, [key]: !p[key] }))

  const save = async () => {
    setSaving(true)
    try {
      await updateUser(user.id, { nudge_prefs: prefs })
      await refreshProfile(user.id)
      toast.success('Nudge preferences saved')
      onSaved?.(prefs)
      onClose()
    } catch (e) {
      toast.error(e.message || 'Could not save preferences')
    } finally { setSaving(false) }
  }

  const grouped = Object.keys(NUDGE_GROUPS).map(g => ({
    group: g, label: NUDGE_GROUPS[g], types: NUDGE_TYPES.filter(t => t.group === g),
  }))

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 540 }}>
        <div className="modal-head">
          <div className="row" style={{ gap: 8 }}>
            <Sparkles size={15} color="var(--accent)" />
            <h3 style={{ margin: 0 }}>{locked ? 'Unlock AI nudges' : 'Configure AI nudges'}</h3>
          </div>
          <button className="btn ghost icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {locked && (
            <div className="card spotlight" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
              <Lock size={16} color="var(--accent)" />
              <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                AI nudges are a <b>Pro &amp; Elite</b> feature. Upgrade to get proactive, one-click
                reminders across your search. Here's everything you'd get:
              </div>
            </div>
          )}
          {!locked && (
            <div className="eyebrow" style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>
              Pick the kinds of reminders Hired should surface for you.
            </div>
          )}

          {grouped.map(({ group, label, types }) => (
            <div key={group} style={{ marginTop: 6 }}>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>{label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {types.map(t => (
                  <button key={t.key}
                    onClick={() => !locked && toggle(t.key)}
                    disabled={locked}
                    className="card"
                    style={{
                      padding: '10px 12px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                      cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.7 : 1,
                    }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.75, fontWeight: 600 }}>{t.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{t.desc}</div>
                    </div>
                    <Switch on={!locked && prefs[t.key]} dimmed={locked} />
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            {locked ? (
              <button className="btn indigo" onClick={() => { onClose(); openUpgrade('nudges') }}>
                <Sparkles size={13} />Upgrade to unlock
              </button>
            ) : (
              <button className="btn indigo" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save preferences'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Switch({ on, dimmed }) {
  return (
    <span style={{
      width: 34, height: 20, borderRadius: 999, flexShrink: 0, position: 'relative',
      background: dimmed ? 'var(--line-2)' : (on ? 'var(--accent)' : 'var(--line-2)'),
      transition: 'background 120ms',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left 120ms',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      }} />
    </span>
  )
}
