// Wires buildCheck.ts to the browser: the build id from /api/version, a check
// whenever the app is shown again, and a chance to reload on each change of
// screen. Only in a production build, where the server serves the app.

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { createBuildCheck, type BuildCheck } from './buildCheck'
import { pageBusy } from './pageBusy'

/** The running build's id, asked past every cache, or null when the server gives none. */
async function fetchBuild(): Promise<string | null> {
  const response = await fetch('/api/version', { cache: 'no-store' })
  if (!response.ok) return null
  const { build } = (await response.json()) as { build?: unknown }
  return typeof build === 'string' ? build : null
}

function browserBuildCheck(): BuildCheck {
  return createBuildCheck({
    fetchBuild,
    isBusy: () => pageBusy(),
    reload: () => window.location.reload(),
    now: () => Date.now(),
  })
}

export function useBuildCheck(enabled: boolean = import.meta.env.PROD): void {
  const [check] = useState(browserBuildCheck)
  const { pathname } = useLocation()

  useEffect(() => {
    if (!enabled) return
    void check.start()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check.shown()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [enabled, check])

  useEffect(() => {
    if (enabled) check.navigated()
  }, [enabled, check, pathname])
}
