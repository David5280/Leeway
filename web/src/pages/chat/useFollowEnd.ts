// Keeps the end of Chat in view as an answer streams in, the way a chat
// app does, but only while the reader is already there: someone who
// scrolled up to reread something is left where they are.

import { useEffect, useRef, type RefObject } from 'react'

/** How near the bottom of the screen the end may be and still count as there, in pixels. */
const NEAR = 80

/** Whether the end marker is on screen, or just below it. */
function inView(end: HTMLElement): boolean {
  return end.getBoundingClientRect().top <= window.innerHeight + NEAR
}

/**
 * Scrolls `end` into view whenever `changed` changes (a new message, each
 * piece of streamed text) while the reader is following along. Whether
 * they are is read on every scroll, theirs or this hook's, and not when
 * text arrives: new text pushes the end down without anyone scrolling.
 */
export function useFollowEnd(end: RefObject<HTMLElement | null>, changed: string): void {
  const following = useRef(true)

  useEffect(() => {
    const onScroll = () => {
      if (end.current) following.current = inView(end.current)
    }
    // Captured, so a scroll in any container counts, not only the window's.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [end])

  useEffect(() => {
    if (following.current) end.current?.scrollIntoView?.({ block: 'end' })
  }, [end, changed])
}
