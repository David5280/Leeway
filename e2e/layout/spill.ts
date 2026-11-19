// (f) A control reaching past the edge of the surface it sits on: a row in a
// card that is wider than the card. Its press and hover backgrounds then
// paint outside the card, so a pressed row looks like a second card drawn
// over the first. A surface is the nearest box that paints a background or a
// border; one that clips its overflow is the clipped check's to judge.

import { alphaOf, CONTROLS, describe, isShown } from './elements'
import { toBox, TOUCHING, type Box } from './geometry'
import type { LayoutProblem } from './types'

const SIDES = ['top', 'right', 'bottom', 'left']

/** Whether a box draws something of its own: a background or a border. */
function paints(el: Element): boolean {
  const style = getComputedStyle(el)
  if (alphaOf(style.backgroundColor) > 0 || style.backgroundImage !== 'none') return true
  return SIDES.some(
    (side) =>
      parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
      style.getPropertyValue(`border-${side}-style`) !== 'none',
  )
}

/** Whether a box cuts off what reaches past it. */
function clips(el: Element): boolean {
  const style = getComputedStyle(el)
  return style.overflowX !== 'visible' || style.overflowY !== 'visible'
}

/** The nearest ancestor that paints, short of the page itself; null on the bare page. */
function surfaceOf(el: Element): Element | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) return null
    if (paints(node)) return node
  }
  return null
}

/** How far, in whole pixels, each side of `inner` reaches past `outer`. */
function reach(inner: Box, outer: Box): { side: string; by: number }[] {
  return [
    { side: 'left', by: outer.left - inner.left },
    { side: 'right', by: inner.right - outer.right },
    { side: 'top', by: outer.top - inner.top },
    { side: 'bottom', by: inner.bottom - outer.bottom },
  ]
    .filter(({ by }) => by > TOUCHING)
    .map(({ side, by }) => ({ side, by: Math.round(by) }))
}

export function findSpills(): LayoutProblem[] {
  const problems: LayoutProblem[] = []
  for (const control of document.querySelectorAll(CONTROLS)) {
    if (!isShown(control)) continue
    const surface = surfaceOf(control)
    if (!surface || clips(surface)) continue
    const sides = reach(
      toBox(control.getBoundingClientRect()),
      toBox(surface.getBoundingClientRect()),
    )
    if (sides.length === 0) continue
    const where = sides.map(({ side, by }) => `${by}px past the ${side}`).join(' and ')
    problems.push({
      check: 'spill',
      message: `${describe(control)} reaches ${where} edge of ${describe(surface)}`,
    })
  }
  return problems
}
