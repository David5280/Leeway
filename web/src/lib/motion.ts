// Motion helpers: whether the device asks for less motion, and a number that
// counts up to its value. Motion is decoration only, so when the device asks
// for less, or cannot say (no matchMedia, as in tests), nothing moves and
// every value is shown as it is straight away.

import { useEffect, useRef, useState } from 'react'

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

/** True when motion should be left out: asked for, or the device cannot tell us. */
function reducedNow(): boolean {
  const media = window.matchMedia?.(REDUCE_QUERY)
  return media ? media.matches : true
}

/** Whether to leave motion out, kept up to date as the device setting changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reducedNow)
  useEffect(() => {
    const media = window.matchMedia?.(REDUCE_QUERY)
    if (!media) return
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

/** Fast at first, settling gently onto the value: an ease-out cubic, 0 to 1. */
export function easeOutCubic(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress))
  return 1 - (1 - clamped) ** 3
}

/**
 * Where a count is after `elapsed` of `duration` milliseconds, from `from` to
 * `to`, rounded to whole units of the value (cents for money).
 */
export function countAt(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0) return to
  return Math.round(from + (to - from) * easeOutCubic(elapsed / duration))
}

/**
 * A number that counts from where it was (0 at first) to `target` over
 * `duration` ms, one animation frame at a time. With less motion asked for
 * it is always just `target`.
 */
export function useCountUp(target: number, duration = 700): number {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(reduced ? target : 0)
  // The value on screen, where the next count starts when the target changes.
  const onScreen = useRef(shown)

  useEffect(() => {
    if (reduced || onScreen.current === target) return
    const from = onScreen.current
    let frame = 0
    let start: number | null = null
    const step = (now: number) => {
      start ??= now
      const elapsed = now - start
      onScreen.current = countAt(from, target, elapsed, duration)
      setShown(onScreen.current)
      if (elapsed < duration) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, reduced])

  return reduced ? target : shown
}
