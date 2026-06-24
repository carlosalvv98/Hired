import { Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import Drawer from './Drawer'
import EmailDrawer from './EmailDrawer'
import CmdK from './CmdK'
import MobileLayout from './MobileLayout'
import UpgradeModal from './UpgradeModal'
import ComposeEmail from './ComposeEmail'
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
  const { drawerId, emailId, cmdK, closeCmdK, closeDrawer, closeEmail, upgradeFeature, closeUpgrade, composeState, closeCompose } = useUI()
  const isMobile = useIsMobile()
  const [counts, setCounts] = useState({ '/tracker': 0, '/inbox': 0 })

  // After a send, close the composer and let any open email list refresh.
  const onComposeSent = () => {
    closeCompose()
    window.dispatchEvent(new CustomEvent('hired:email-sent'))
  }

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
        {emailId && <EmailDrawer id={emailId} onClose={closeEmail} />}
        {cmdK && <CmdK initialTab={cmdK} onClose={closeCmdK} />}
        {upgradeFeature && <UpgradeModal feature={upgradeFeature} onClose={closeUpgrade} />}
        {composeState && <ComposeEmail key={JSON.stringify(composeState)} {...composeState} onClose={closeCompose} onSent={onComposeSent} />}
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
        {emailId && <EmailDrawer id={emailId} onClose={closeEmail} />}
        {cmdK && <CmdK initialTab={cmdK} onClose={closeCmdK} />}
        {upgradeFeature && <UpgradeModal feature={upgradeFeature} onClose={closeUpgrade} />}
        {composeState && <ComposeEmail key={JSON.stringify(composeState)} {...composeState} onClose={closeCompose} onSent={onComposeSent} />}
      </div>
    </div>
  )
}
