import { Search, Bell, Sparkles } from 'lucide-react'
import { useUI } from '../hooks/useUI'

export default function AppBar({ title, crumbs, right }) {
  const { setCmdK } = useUI()
  return (
    <div className="appbar">
      <h1>{title}</h1>
      {crumbs && <span className="crumbs">/ {crumbs}</span>}
      <span className="spacer" />
      <div className="search" onClick={() => setCmdK(true)}>
        <Search size={14} strokeWidth={1.6} />
        <span>Search apps, contacts, emails…</span>
        <span className="kbd">⌘K</span>
      </div>
      {right || (
        <>
          <button className="btn ghost tiny" title="Notifications">
            <Bell size={14} strokeWidth={1.6} />
          </button>
          <button className="btn ai tiny" onClick={() => setCmdK(true)}>
            <Sparkles size={13} strokeWidth={1.6} />
            Ask AI
          </button>
        </>
      )}
    </div>
  )
}
