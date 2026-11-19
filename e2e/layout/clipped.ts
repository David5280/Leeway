// (b) Text cut off by a box that hides its overflow without an ellipsis, or
// spilling past the edge of the box it sits in. Text in a box that scrolls
// sideways (a row of pills, a wide table) is a swipe away, so it is fine.

import { blockOf, describe, isShown, isSvg, lineWidth, paddingBox } from './elements'
import { TOUCHING, union, type Box } from './geometry'
import { texts } from './text'
import type { LayoutProblem } from './types'

/**
 * What is wrong with one element's text, if anything: walking out from it,
 * the first box its text does not fit in either scrolls (fine), clips (fine
 * only with an ellipsis), or is the block it sits in (a spill).
 */
function cutOff(owner: Element, text: Box): string | null {
  const container = blockOf(owner)
  for (let box: Element | null = owner; box && box !== document.body; box = box.parentElement) {
    const edges = paddingBox(box)
    if (text.left >= edges.left - TOUCHING && text.right <= edges.right + TOUCHING) continue
    const style = getComputedStyle(box)
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') return null
    if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
      if (style.textOverflow === 'ellipsis') return null
      return box === owner ? 'is cut off with no ellipsis' : `is cut off by ${describe(box)}`
    }
    if (box === container) return 'spills out of its box'
  }
  return null
}

/** A picker draws its chosen option itself, so its text is measured in its own font. */
function cutOffPickers(): LayoutProblem[] {
  const context = document.createElement('canvas').getContext('2d')!
  return [...document.querySelectorAll('select')].flatMap((select) => {
    const chosen = select.selectedOptions[0]
    if (!chosen || !isShown(select)) return []
    const style = getComputedStyle(select)
    if (style.textOverflow === 'ellipsis') return []
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    if (context.measureText(chosen.text).width <= lineWidth(select) + TOUCHING) return []
    return [{ check: 'clipped', message: `${describe(select)} cuts off "${chosen.text}"` }]
  })
}

export function findClippedText(): LayoutProblem[] {
  const problems: LayoutProblem[] = texts()
    // Charts place their own labels, outside their boxes on purpose.
    .filter(({ owner }) => !isSvg(owner))
    .flatMap(({ owner, lines }) => {
      const wrong = cutOff(owner, union(lines))
      return wrong ? [{ check: 'clipped', message: `${describe(owner)} ${wrong}` }] : []
    })
  return [...problems, ...cutOffPickers()]
}
