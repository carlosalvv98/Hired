import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'

const UICtx = createContext(null)

export function UIProvider({ children }) {
  const [params, setParams] = useSearchParams()
  const drawerId = params.get('app')
  const emailId = params.get('email')
  // CmdK is now a right-side sidebar. State holds the active tab — 'search' or
  // 'ask' — or null when closed. (Truthy = open.)
  const [cmdK, setCmdK] = useState(null)
  const [aiPanel, setAiPanel] = useState(() => {
    try { return localStorage.getItem('hired.aiPanel') === '1' } catch { return false }
  })
  // When set, the global UpgradeModal is open. The string identifies which
  // feature triggered it (used to highlight the right row in the comparison
  // table). Set to '*' for a manual open with no specific feature focus.
  const [upgradeFeature, setUpgradeFeature] = useState(null)
  // null = closed. Otherwise { mode, originalEmail, prefillTo, prefillSubject,
  // prefillBody, applicationId } — drives the floating ComposeEmail panel.
  const [composeState, setComposeState] = useState(null)
  const composeRef = useRef(null)
  useEffect(() => { composeRef.current = composeState }, [composeState])
  const nav = useNavigate()

  const openUpgrade = useCallback((feature = '*') => setUpgradeFeature(feature), [])
  const closeUpgrade = useCallback(() => setUpgradeFeature(null), [])

  // Only one composer may be open at a time. If one is already up, surface a
  // toast and leave it untouched rather than blowing away unsaved work.
  const openCompose = useCallback((config = {}) => {
    if (composeRef.current) {
      toast('Close the current message first')
      return
    }
    setComposeState({ mode: 'new', ...config })
  }, [])
  const closeCompose = useCallback(() => setComposeState(null), [])

  // Only one sidebar (CmdK / Drawer / EmailDrawer) is open at a time. Opening
  // CmdK closes the drawers; opening a drawer closes CmdK.
  const closeCmdK = useCallback(() => setCmdK(null), [])
  const openCmdK = useCallback((tab = 'search') => {
    const next = new URLSearchParams(params)
    next.delete('app')
    next.delete('email')
    setParams(next, { replace: false })
    setCmdK(tab === 'ask' ? 'ask' : 'search')
  }, [params, setParams])

  const openDrawer = useCallback((id) => {
    setCmdK(null)
    const next = new URLSearchParams(params)
    next.set('app', id)
    setParams(next, { replace: false })
  }, [params, setParams])

  const closeDrawer = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete('app')
    setParams(next, { replace: false })
  }, [params, setParams])

  const openEmail = useCallback((id) => {
    setCmdK(null)
    const next = new URLSearchParams(params)
    next.set('email', id)
    setParams(next, { replace: false })
  }, [params, setParams])

  const closeEmail = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete('email')
    setParams(next, { replace: false })
  }, [params, setParams])

  const toggleAiPanel = useCallback(() => {
    setAiPanel(v => {
      const nv = !v
      try { localStorage.setItem('hired.aiPanel', nv ? '1' : '0') } catch {}
      return nv
    })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (cmdK) closeCmdK()
        else openCmdK('search')
      }
      if (e.key === 'Escape') {
        if (cmdK) closeCmdK()
        else if (emailId) closeEmail()
        else if (drawerId) closeDrawer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cmdK, openCmdK, closeCmdK, drawerId, closeDrawer, emailId, closeEmail])

  return (
    <UICtx.Provider value={{
      drawerId, openDrawer, closeDrawer,
      emailId, openEmail, closeEmail,
      cmdK, openCmdK, closeCmdK, aiPanel, toggleAiPanel,
      upgradeFeature, openUpgrade, closeUpgrade,
      composeState, openCompose, closeCompose,
      navigate: nav,
    }}>
      {children}
    </UICtx.Provider>
  )
}

export const useUI = () => useContext(UICtx)
