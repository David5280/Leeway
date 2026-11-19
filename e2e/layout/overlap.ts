// (a) Text drawn over other text, or over a control it is not part of.

import { CONTROLS, clipArea, describe, isShown, layerOf, shownBox } from './elements'
import {
  boxAround,
  cornersOf,
  height,
  intersect,
  overlaps,
  shapesOverlap,
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

export function findOverlaps(): LayoutProblem[] {
  const pieces = [...textPieces(), ...controlPieces()]
  // Each pair of elements once, however many of their lines meet.
  const messages = new Set<string>()
  pieces.forEach((a, i) => {
    for (const b of pieces.slice(i + 1)) {
      if (collide(a, b)) messages.add(`${describe(a.owner)} overlaps ${describe(b.owner)}`)
    }
  })
  return [...messages].map((message) => ({ check: 'overlap', message }))
}
