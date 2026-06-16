import { NavLink } from 'react-router-dom'
import { Home, Layers, Inbox, Calendar, FileText, Users, Settings, Plug, LogOut, Sparkles } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUI } from '../hooks/useUI'
import toast from 'react-hot-toast'

const ITEMS = [
  { to: '/',            label: 'Dashboard',   Icon: Home },
  { to: '/tracker',     label: 'Tracker',     Icon: Layers },
  { to: '/inbox',       label: 'Inbox',       Icon: Inbox },
  { to: '/calendar',    label: 'Calendar',    Icon: Calendar },
  { to: '/resumes',     label: 'Resumes',     Icon: FileText },
  { to: '/connections', label: 'Contacts & Connections', Icon: Users },
]

export default function Sidebar({ counts = {} }) {
  const { profile, user, signOut } = useAuth()
  const { openUpgrade } = useUI()
  const initials = profile?.name
    ? profile.name.split(' ').map(s => s[0]).join('').toUpperCase().slice(0, 2)
    : (profile?.email?.[0]?.toUpperCase() || 'U')

  const onSignOut = async () => {
    await signOut()
    toast.success('Signed out')
  }

  return (
    <div className="sidebar">
      <NavLink to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="brand-mark">H</div>
        <div className="brand-name">Hired</div>
      </NavLink>
      {ITEMS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} end={to === '/'}
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="ico"><Icon size={16} strokeWidth={1.6} /></span>
          <span>{label}</span>
          {counts[to] ? <span className="badge-n">{counts[to]}</span> : null}
        </NavLink>
      ))}
      <div className="nav-section">Workspace</div>
      <NavLink to="/integrations" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="ico"><Plug size={16} strokeWidth={1.6} /></span>
        <span>Integrations</span>
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="ico"><Settings size={16} strokeWidth={1.6} /></span>
        <span>Settings</span>
      </NavLink>
      <div style={{ flex: 1 }} />
      <div className="sidebar-foot">
        {(user?.plan || 'free') === 'free' && (
          <button className="sidebar-upgrade" onClick={() => openUpgrade('*')}>
            <span className="ico"><Sparkles size={13} /></span>
            <span style={{ flex: 1, textAlign: 'left' }}>
              <span className="t">Upgrade to Pro</span>
              <small>Unlock unlimited AI</small>
            </span>
          </button>
        )}
        <div className="sidebar-user">
          <div className="av">{initials}</div>
          <div className="who" style={{ flex: 1, minWidth: 0 }}>
            <div className="name-row">
              {profile?.name || profile?.email || 'You'}
              <PlanTag plan={user?.plan || 'free'} />
            </div>
            <small>{profile?.email}</small>
          </div>
          <button className="btn ghost icon" title="Sign out" onClick={onSignOut}>
            <LogOut size={14} strokeWidth={1.6} />
          </button>
        </div>
      </div>
    </div>
  )
}

const PLAN_LABEL = { free: 'Free', pro: 'Pro', elite: 'Elite', university: 'University' }
function PlanTag({ plan }) {
  return (
    <span className={`plan-tag plan-${plan}`}>{PLAN_LABEL[plan] || plan}</span>
  )
}
