// Keeps how far a scrolling area was scrolled in a ref that outlives it, and
// puts it back when the area is drawn again: Ask Leeway's box is drawn anew
// each time it opens and on every tab, yet opens where the owner left it.

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Spread the result on the scrolling element. `keptRef` lives above the pages
 * (AskProvider); `drawn` says the area is on screen with its content, so the
 * scroll is put back once, after the conversation's own jump to its end
 * (an effect of the caller declared after useFollowEnd's, so it runs later).
 */
export function useKeptScroll(keptRef: RefObject<number | null> | undefined, drawn: boolean) {
  const area = useRef<HTMLDivElement>(null)
  const restored = useRef(false)

  useEffect(() => {
    if (!drawn || restored.current || !keptRef || !area.current) return
    restored.current = true
    if (keptRef.current !== null) area.current.scrollTop = keptRef.current
  }, [keptRef, drawn])

  const onScroll = () => {
    if (keptRef && area.current) keptRef.current = area.current.scrollTop
  }
  return { ref: area, onScroll }
}
