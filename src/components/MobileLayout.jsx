import { NavLink } from 'react-router-dom'
import { Home, Layers, Inbox, Sparkles, User } from 'lucide-react'
import { useUI } from '../hooks/useUI'

const TABS = [
  { to: '/',            label: 'Home',   Icon: Home },
  { to: '/tracker',     label: 'Track',  Icon: Layers },
  { to: '/inbox',       label: 'Inbox',  Icon: Inbox },
]

export default function MobileLayout({ children }) {
  const { openCmdK } = useUI()
  return (
    <div className="mobile-shell">
      <div style={{ flex: 1, paddingBottom: 80 }}>{children}</div>
      <div className="m-bottomnav">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) => `item ${isActive ? 'on' : ''}`}>
            <Icon size={20} strokeWidth={1.6} />
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="item" onClick={() => openCmdK('ask')}>
          <Sparkles size={20} strokeWidth={1.6} />
          <span>AI</span>
        </div>
        <NavLink to="/connections" className={({ isActive }) => `item ${isActive ? 'on' : ''}`}>
          <User size={20} strokeWidth={1.6} />
          <span>Me</span>
        </NavLink>
      </div>
    </div>
  )
}
