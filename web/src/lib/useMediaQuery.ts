// Whether a CSS media query matches, kept up to date as the window changes
// size or turns. Where the browser cannot say (no matchMedia, as in tests),
// it answers false, so the phone layout is the default.

import { useSyncExternalStore } from 'react'

/** Whether `query` matches now, re-rendering when that changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia?.(query)
      if (!media) return () => {}
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia?.(query).matches ?? false,
  )
}
