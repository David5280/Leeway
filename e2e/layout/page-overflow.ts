// (d) The page is wider than the screen, so it scrolls sideways, or something
// runs off the screen's side where no swipe can reach it. A page that hides
// its sideways overflow (overflow-x: hidden on html or body) would hide both
// from a person and from this check, so that is reported too.

import { describe, isShown, shownBox } from './elements'
import { TOUCHING } from './geometry'
import type { LayoutProblem } from './types'

/** Names at most this many of the elements that stick out. */
const NAMED = 5

/** The page's own roots that cut off sideways overflow instead of letting it scroll. */
function hidingRoots(): LayoutProblem[] {
  return [document.documentElement, document.body]
    .filter((root) => ['hidden', 'clip'].includes(getComputedStyle(root).overflowX))
    .map((root) => ({
      check: 'page-overflow',
      message: `<${root.tagName.toLowerCase()}> hides sideways overflow (overflow-x: ${getComputedStyle(root).overflowX}), so content past the edge is cut off unseen`,
    }))
}

/** The innermost shown elements past the screen's left or right edge. */
function sticking(): Element[] {
  const edge = document.documentElement.clientWidth
  return (
    [...document.body.querySelectorAll('*')]
      .filter((el) => {
        if (!isShown(el)) return false
        const box = shownBox(el)
        return box.right > edge + TOUCHING || box.left < -TOUCHING
      })
      // The innermost ones say the most: their parents only stick out because of them.
      .filter((el, _, all) => !all.some((other) => other !== el && el.contains(other)))
  )
}

export function findPageOverflow(): LayoutProblem[] {
  const extra = document.documentElement.scrollWidth - document.documentElement.clientWidth
  const outside = sticking()
  if (extra <= 0 && outside.length === 0) return hidingRoots()
  const what =
    extra > 0 ? `the page is ${extra}px wider than the screen` : 'content runs off the screen'
  const naming = outside.length
    ? `; sticking out: ${outside.slice(0, NAMED).map(describe).join(', ')}`
    : ''
  return [...hidingRoots(), { check: 'page-overflow', message: `${what}${naming}` }]
}
