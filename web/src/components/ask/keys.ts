// The "/" key jumps to Ask Leeway from anywhere, the way it jumps to search
// on many sites, except while typing in a field: there it is a slash. The
// rules match the tab keys' (shell/tabs.ts).

import { useEffect } from 'react'
import { isTyping } from '../shell/tabs'

/** The key presses slashKey reads. */
type KeyPress = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'target' | 'defaultPrevented'
>

/**
 * Whether a press is the "/" that opens Ask Leeway: the key alone, while
 * focus is not in a field. Shift is allowed, since some keyboards need it
 * to type a slash at all.
 */
export function slashKey(press: KeyPress): boolean {
  if (press.defaultPrevented) return false
  if (press.altKey || press.ctrlKey || press.metaKey) return false
  if (isTyping(press.target)) return false
  return press.key === '/'
}

/** Listens for "/" while `onSlash` is given; with null (no AI key) the key is left alone. */
export function useSlashKey(onSlash: (() => void) | null): void {
  useEffect(() => {
    if (!onSlash) return
    function onKeyDown(event: KeyboardEvent) {
      if (!slashKey(event)) return
      event.preventDefault()
      onSlash?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onSlash])
}
