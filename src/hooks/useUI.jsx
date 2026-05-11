import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const UICtx = createContext(null)

export function UIProvider({ children }) {
  const [params, setParams] = useSearchParams()
  const drawerId = params.get('app')
  const [cmdK, setCmdK] = useState(false)
  const [aiPanel, setAiPanel] = useState(() => {
    try { return localStorage.getItem('hired.aiPanel') === '1' } catch { return false }
  })
  // When set, the global UpgradeModal is open. The string identifies which
  // feature triggered it (used to highlight the right row in the comparison
  // table). Set to '*' for a manual open with no specific feature focus.
  const [upgradeFeature, setUpgradeFeature] = useState(null)
  const nav = useNavigate()

  const openUpgrade = useCallback((feature = '*') => setUpgradeFeature(feature), [])
  const closeUpgrade = useCallback(() => setUpgradeFeature(null), [])

  const openDrawer = useCallback((id) => {
    const next = new URLSearchParams(params)
    next.set('app', id)
    setParams(next, { replace: false })
  }, [params, setParams])

  const closeDrawer = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete('app')
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
        setCmdK(c => !c)
      }
      if (e.key === 'Escape') {
        if (cmdK) setCmdK(false)
        else if (drawerId) closeDrawer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cmdK, drawerId, closeDrawer])

  return (
    <UICtx.Provider value={{
      drawerId, openDrawer, closeDrawer,
      cmdK, setCmdK, aiPanel, toggleAiPanel,
      upgradeFeature, openUpgrade, closeUpgrade,
      navigate: nav,
    }}>
      {children}
    </UICtx.Provider>
  )
}

export const useUI = () => useContext(UICtx)
