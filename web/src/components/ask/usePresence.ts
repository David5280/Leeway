// Keeps something on screen a moment after it is closed, so it can play its
// way out (Ask Leeway's box shrinking back into its button) before it goes.

import { useEffect, useState } from 'react'

export interface Presence {
  /** Whether to draw it at all: while open, and while leaving. */
  mounted: boolean
  /** Closed, but still drawn while it plays its way out. */
  leaving: boolean
}

/** Whether to draw something that is `open`, kept `exitMs` past its closing. */
export function usePresence(open: boolean, exitMs: number): Presence {
  const [mounted, setMounted] = useState(open)
  // Drawn the moment it opens, in this same render, never a frame late.
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open || !mounted) return
    const timer = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(timer)
  }, [open, mounted, exitMs])

  return { mounted: open || mounted, leaving: !open && mounted }
}
