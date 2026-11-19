// (a) Text drawn over other text, or over a control it is not part of; and
// page text or controls coming to rest under a fixed bar, like the last row
// of a page left under the tab bar.

import { CONTROLS, clipArea, describe, isShown, layerOf, shownBox } from './elements'
import {
  boxAround,
  cornersOf,
  height,
  intersect,
  isScrolledToEnd,
  isScrolledToTop,
  overlaps,
  shapesOverlap,
  toBox,
  TOUCHING,
  viewport,
  width,
  type Box,
  type Point,
} from './geometry'
import { LINE_TRIM, texts, turnedTextCorners } from './text'
import type { LayoutProblem } from './types'

/** One line of text, or one control, as drawn on the screen. */
interface Piece {
  owner: Element
  /** Its corners on screen, in order around it: a turned chart label is not upright. */
  corners: Point[]
  /** The upright box around the corners, for a quick first test. */
  box: Box
  text: boolean
  /** The fixed bar it floats in, if any. */
  layer: Element | null
}

const piece = (owner: Element, corners: Point[], text: boolean): Piece => ({
  owner,
  corners,
  box: boxAround(corners),
  text,
  layer: layerOf(owner),
})

/** Each line of text on the page, trimmed to its letters and to where it shows. */
function textPieces(): Piece[] {
  return texts().flatMap(({ owner, lines }) => {
    const turned = turnedTextCorners(owner)
    if (turned) return [piece(owner, turned, true)]
    const area = clipArea(owner, true)
    return lines
      .map((line) => {
        const trim = height(line) * LINE_TRIM
        return intersect({ ...line, top: line.top + trim, bottom: line.bottom - trim }, area)
      })
      .filter((box) => width(box) > 0 && height(box) > 0)
      .map((box) => piece(owner, cornersOf(box), true))
  })
}

/** Each control on the page, where it shows. */
function controlPieces(): Piece[] {
  return [...document.querySelectorAll(CONTROLS)]
    .filter(isShown)
    .map((control) => piece(control, cornersOf(shownBox(control)), false))
}

/** Whether two pieces are drawn one over the other where they should not be. */
function collide(a: Piece, b: Piece): boolean {
  // Control over control is a layout choice; text must be covered by neither.
  if (!a.text && !b.text) return false
  // An element and its own parts (a button and its label) always share space.
  if (a.owner === b.owner || a.owner.contains(b.owner) || b.owner.contains(a.owner)) return false
  // A fixed bar floats over the page as it scrolls; that is what it is for.
  if (a.layer !== b.layer) return false
  return overlaps(a.box, b.box) && shapesOverlap(a.corners, b.corners)
}

/**
 * The fixed bars that page content must come to rest clear of, now: a bar
 * along the top edge while the page is at its top, and one along the bottom
 * edge (the tab bar) once it is scrolled to its end. In between, content
 * passes under them as in any app.
 */
function barsAtRest(pieces: Piece[]): { bar: Element; box: Box }[] {
  const screen = viewport()
  const layers = new Set(pieces.flatMap((p) => (p.layer ? [p.layer] : [])))
  return [...layers]
    .map((bar) => ({ bar, box: toBox(bar.getBoundingClientRect()) }))
    .filter(
      ({ box }) =>
        (isScrolledToTop() && box.top <= TOUCHING) ||
        (isScrolledToEnd() && box.bottom >= screen.bottom - TOUCHING),
    )
}

/** Page text and controls resting under a fixed bar, where nobody can read or reach them. */
function underBars(pieces: Piece[]): string[] {
  const bars = barsAtRest(pieces)
  return pieces
    .filter((p) => p.layer === null)
    .flatMap((p) => {
      const over = bars.find(({ box }) => overlaps(p.box, box))
      return over ? [`${describe(p.owner)} rests under ${describe(over.bar)}`] : []
    })
}

export function findOverlaps(): LayoutProblem[] {
  const pieces = [...textPieces(), ...controlPieces()]
  // Each pair of elements once, however many of their lines meet.
  const messages = new Set<string>()
  pieces.forEach((a, i) => {
    for (const b of pieces.slice(i + 1)) {
      if (collide(a, b)) messages.add(`${describe(a.owner)} overlaps ${describe(b.owner)}`)
    }
  })
  for (const message of underBars(pieces)) messages.add(message)
  return [...messages].map((message) => ({ check: 'overlap', message }))
}
