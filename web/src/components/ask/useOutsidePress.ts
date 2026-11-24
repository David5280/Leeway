// Hears a press anywhere outside Ask Leeway's box, so a tap on the page
// shrinks it back into its button.
//
// "Inside" is decided by React's tree, not the page's: React passes a press
// up through portals, so anything the box opens elsewhere on the page still
// counts as the box. The box's own handler marks the press first (React
// listens at the app's root), then the document hears it bubble up.
//
// The press is never stopped: whatever it landed on (a tab, a card, a
// button) still does its job, so closing never costs the owner a tap.

import { useEffect, useRef } from 'react'
import { FOCUSABLE } from './useKeyboardReach'

/** Whether a press landed on something that takes focus itself, like a field or a link. */
export function takesFocus(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(FOCUSABLE) !== null
}

/**
 * Calls `onOutside` with where a press landed, for every press outside the
 * element while `active`. Spread the result on the element.
 */
export function useOutsidePress(
  active: boolean,
  onOutside: (target: EventTarget | null) => void,
): { onPointerDown: () => void } {
  const inside = useRef(false)
  const latest = useRef(onOutside)
  useEffect(() => {
    latest.current = onOutside
  })

  useEffect(() => {
    if (!active) return
    function onPress(event: PointerEvent) {
      const wasInside = inside.current
      inside.current = false
      if (!wasInside) latest.current(event.target)
    }
    document.addEventListener('pointerdown', onPress)
    return () => document.removeEventListener('pointerdown', onPress)
  }, [active])

  return {
    onPointerDown: () => {
      inside.current = true
    },
  }
}
