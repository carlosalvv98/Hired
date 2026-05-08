import { NavLink } from 'react-router-dom'
import { Home, Layers, Inbox, Calendar, FileText, Users, Settings, Plug, LogOut } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const ITEMS = [
  { to: '/',            label: 'Dashboard',   Icon: Home },
  { to: '/tracker',     label: 'Tracker',     Icon: Layers },
  { to: '/inbox',       label: 'Inbox',       Icon: Inbox },
  { to: '/calendar',    label: 'Calendar',    Icon: Calendar },
  { to: '/resumes',     label: 'Resumes',     Icon: FileText },
  { to: '/connections', label: 'Connections', Icon: Users },
]

export default function Sidebar({ counts = {} }) {
  const { profile, signOut } = useAuth()
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
      <div className="sidebar-foot">
        <div className="av">{initials}</div>
        <div className="who" style={{ flex: 1, minWidth: 0 }}>
          {profile?.name || profile?.email || 'You'}
          <small>{profile?.email}</small>
        </div>
        <button className="btn ghost icon" title="Sign out" onClick={onSignOut}>
          <LogOut size={14} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  )
}
