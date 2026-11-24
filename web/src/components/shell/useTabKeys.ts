// Keys 1 to 5 switch tabs from anywhere in the app, on any width. The rules
// for which presses count live in tabs.ts (tabKey).

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { tabKey } from './tabs'

/** Listens for the tab keys while the shell is on screen. */
export function useTabKeys() {
  const navigate = useNavigate()
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tab = tabKey(event)
      if (!tab) return
      event.preventDefault()
      navigate(tab.to)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate])
}
