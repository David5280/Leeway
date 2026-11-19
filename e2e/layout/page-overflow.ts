// (d) The page is wider than the screen, so it scrolls sideways.

import { describe, isShown, shownBox } from './elements'
import { TOUCHING } from './geometry'
import type { LayoutProblem } from './types'

/** Names at most this many of the elements that stick out. */
const NAMED = 5

export function findPageOverflow(): LayoutProblem[] {
  const edge = document.documentElement.clientWidth
  const extra = document.documentElement.scrollWidth - edge
  if (extra <= 0) return []
  const sticking = [...document.body.querySelectorAll('*')]
    .filter((el) => isShown(el) && shownBox(el).right > edge + TOUCHING)
    // The innermost ones say the most: their parents only stick out because of them.
    .filter((el, _, all) => !all.some((other) => other !== el && el.contains(other)))
    .slice(0, NAMED)
    .map(describe)
  const naming = sticking.length ? `; sticking out: ${sticking.join(', ')}` : ''
  return [
    { check: 'page-overflow', message: `the page is ${extra}px wider than the screen${naming}` },
  ]
}
