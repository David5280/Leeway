// (a, continued) Text hidden under a box laid over it: a card, a panel or a
// chart's bar that fills its box, drawn on top of another element's text at
// a spot where the box has no text of its own. Text against text is overlap.ts's
// to find; this asks the browser what is on top at points along each line.

import { apart, fills, floatOf } from './elements'
import { boxAround, viewport, type Point } from './geometry'

/** A line of text as overlap.ts measured it: its owner, corners and floating layer. */
export interface Line {
  owner: Element
  corners: Point[]
  layer: Element | null
}

/** Where along a line its cover is looked for, as shares of its width. */
const ALONG = [0.1, 0.5, 0.9]

/**
 * Lets every element take a hit while the check runs, so what is found at a
 * point is what is painted on top there. Otherwise a box that ignores the
 * pointer would not be seen over text, and text that ignores it would seem
 * covered by what is under it. Returns how to put the page back.
 */
function hitEverything(): () => void {
  const style = document.createElement('style')
  style.textContent = '*, *::before, *::after { pointer-events: auto !important; }'
  document.head.append(style)
  return () => style.remove()
}

/** Points along the middle of a line, those on screen (the browser can only hit those). */
function pointsOn(line: Line): Point[] {
  const box = boxAround(line.corners)
  const screen = viewport()
  const middle = (box.top + box.bottom) / 2
  // A turned chart label is checked at its middle alone, which lies on it.
  const shares =
    line.corners.length === 4 && line.corners[0]!.y === line.corners[1]!.y ? ALONG : [0.5]
  return shares
    .map((share) => ({ x: box.left + (box.right - box.left) * share, y: middle }))
    .filter(({ x, y }) => x >= 0 && x < screen.right && y >= 0 && y < screen.bottom)
}

/**
 * What covers a line at a point: the element on top there, or an ancestor of
 * it short of the line's own, that fills its box. Null when the line itself
 * (or something inside it) is on top, or nothing on top fills.
 */
function coverAt(line: Line, { x, y }: Point): Element | null {
  const top = document.elementFromPoint(x, y)
  if (!top || !apart(top, line.owner)) return null
  // A bar or sticky header passes over the page by design; overlap.ts sees to where they rest.
  if (floatOf(top) !== line.layer) return null
  for (
    let node: Element | null = top;
    node && !node.contains(line.owner);
    node = node.parentElement
  ) {
    if (fills(node)) return node
  }
  return null
}

/** A line's owner and the box drawn over it. */
export interface Covered {
  owner: Element
  cover: Element
}

/** Each line of text with a filled box drawn over it, once per owner and box. */
export function findCoveredText(lines: Line[]): Covered[] {
  const restore = hitEverything()
  try {
    const found = lines.flatMap((line) =>
      pointsOn(line).flatMap((point) => {
        const cover = coverAt(line, point)
        return cover ? [{ owner: line.owner, cover }] : []
      }),
    )
    // Several points of a line, and several lines of one owner, find the same box.
    return found.filter(
      (one, index) =>
        found.findIndex((other) => other.owner === one.owner && other.cover === one.cover) ===
        index,
    )
  } finally {
    restore()
  }
}
