import { Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import Drawer from './Drawer'
import CmdK from './CmdK'
import MobileLayout from './MobileLayout'
import UpgradeModal from './UpgradeModal'
import { useUI } from '../hooks/useUI'
import { listApplications, listEmails } from '../lib/api'

const useIsMobile = () => {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900)
  useEffect(() => {
    const handle = () => setM(window.innerWidth < 900)
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])
  return m
}

export default function Layout() {
  const { drawerId, cmdK, setCmdK, closeDrawer, upgradeFeature, closeUpgrade } = useUI()
  const isMobile = useIsMobile()
  const [counts, setCounts] = useState({ '/tracker': 0, '/inbox': 0 })

  useEffect(() => {
    let alive = true
    Promise.all([listApplications(), listEmails({ folder: 'inbox' })])
      .then(([apps, mails]) => {
        if (!alive) return
        setCounts({
          '/tracker': apps.length,
          '/inbox': mails.filter(m => m.is_unread).length,
        })
      }).catch(() => {})
    return () => { alive = false }
  }, [drawerId, cmdK])

  if (isMobile) {
    return (
      <>
        <MobileLayout>
          <Outlet />
        </MobileLayout>
        {drawerId && <Drawer id={drawerId} onClose={closeDrawer} />}
        {cmdK && <CmdK onClose={() => setCmdK(false)} />}
        {upgradeFeature && <UpgradeModal feature={upgradeFeature} onClose={closeUpgrade} />}
      </>
    )
  }

  return (
    <div className="app-root">
      <div className="app-shell" style={{ position: 'relative' }}>
        <Sidebar counts={counts} />
        <div className="main">
          <Outlet />
        </div>
        {drawerId && <Drawer id={drawerId} onClose={closeDrawer} />}
        {cmdK && <CmdK onClose={() => setCmdK(false)} />}
        {upgradeFeature && <UpgradeModal feature={upgradeFeature} onClose={closeUpgrade} />}
      </div>
    </div>
  )
}
