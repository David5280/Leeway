// (b) Text cut off by a box that hides its overflow without an ellipsis, or
// spilling past the edge of the box it sits in, either way: sideways (one line
// too long) or downward (a box too short for its lines). An ellipsis is how a
// line ends early on purpose, and a line clamp how a paragraph does, but only
// when enough of the text is left to read: a name squeezed to "S..." is cut
// off all the same. Text in a box that scrolls (a row of pills, a wide table)
// is a swipe away, so it is fine.

import { blockOf, describe, isShown, isSvg, lineWidth, paddingBox } from './elements'
import { height, TOUCHING, union, width, type Box } from './geometry'
import { LINE_TRIM, texts } from './text'
import type { LayoutProblem } from './types'

/** Below this width, in the text's own font size, an ellipsis leaves too little to read. */
const NARROWEST_ELLIPSIS_EM = 3

type Axis = 'sideways' | 'downward'

const SCROLLS = new Set(['auto', 'scroll'])
const CLIPS = new Set(['hidden', 'clip'])

/**
 * The ways text runs past a box's edges. Downward it is measured by its
 * letters, trimmed by `trim` top and bottom, since a line box runs taller.
 */
function overflowsOf(text: Box, edges: Box, trim: number): Axis[] {
  const axes: Axis[] = []
  if (text.left < edges.left - TOUCHING || text.right > edges.right + TOUCHING) {
    axes.push('sideways')
  }
  if (text.top + trim < edges.top - TOUCHING || text.bottom - trim > edges.bottom + TOUCHING) {
    axes.push('downward')
  }
  return axes
}

/** Whether a box ends its cut-off text on purpose: an ellipsis sideways, a line clamp downward. */
function endsOnPurpose(style: CSSStyleDeclaration, axis: Axis): boolean {
  if (axis === 'sideways') return style.textOverflow === 'ellipsis'
  return style.webkitLineClamp !== 'none' && style.webkitLineClamp !== ''
}

/** What a box that clips does to the text in it, if anything is wrong. */
function clipVerdict(owner: Element, box: Element, axis: Axis): string | null {
  const by = box === owner ? '' : ` by ${describe(box)}`
  if (!endsOnPurpose(getComputedStyle(box), axis)) {
    if (axis === 'downward') return `is cut off at the bottom${by}`
    return box === owner ? 'is cut off with no ellipsis' : `is cut off${by}`
  }
  // An ellipsis at the end of a sliver of text still hides the name.
  const room = width(paddingBox(box))
  const floor = NARROWEST_ELLIPSIS_EM * parseFloat(getComputedStyle(owner).fontSize)
  return room < floor ? `is squeezed to ${Math.round(room)}px${by}` : null
}

/**
 * What is wrong with one element's text, if anything: walking out from it,
 * the first box its text does not fit in either scrolls (fine), clips (fine
 * only when it ends on purpose with room to read), or is the block it sits in
 * (a spill, checked sideways only, since a block grows downward to fit).
 */
function cutOff(owner: Element, lines: Box[]): string | null {
  const text = union(lines)
  const trim = height(lines[0]!) * LINE_TRIM
  const container = blockOf(owner)
  for (let box: Element | null = owner; box && box !== document.body; box = box.parentElement) {
    const axes = overflowsOf(text, paddingBox(box), trim)
    if (axes.length === 0) continue
    const style = getComputedStyle(box)
    for (const axis of axes) {
      const overflow = axis === 'sideways' ? style.overflowX : style.overflowY
      if (SCROLLS.has(overflow)) return null
      if (CLIPS.has(overflow)) return clipVerdict(owner, box, axis)
    }
    if (box === container && axes.includes('sideways')) return 'spills out of its box'
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
      const wrong = cutOff(owner, lines)
      return wrong ? [{ check: 'clipped', message: `${describe(owner)} ${wrong}` }] : []
    })
  return [...problems, ...cutOffPickers()]
}
