// (a) Text drawn over other text, over a control it is not part of, or under
// a box that fills over it (covered.ts); page text or controls coming to rest
// under a fixed bar, like the last row of a page left under the tab bar; and
// two floating layers (fixed bars, held sticky headers) drawn over each other,
// like a bar held over the tab bar.

import { findCoveredText } from './covered'
import { apart, CONTROLS, clipArea, describe, fills, floatOf, isShown, shownBox } from './elements'
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
  /** The fixed bar or held sticky header it floats in, if any. */
  layer: Element | null
}

const piece = (owner: Element, corners: Point[], text: boolean): Piece => ({
  owner,
  corners,
  box: boxAround(corners),
  text,
  layer: floatOf(owner),
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
  // A fixed bar or a held sticky header floats over the page as it scrolls;
  // that is what it is for. Two floating layers apart from each other are
  // both on top, so neither may cover the other (layersOverLayers).
  if (a.layer !== b.layer && !(a.layer && b.layer && apart(a.layer, b.layer))) return false
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

/**
 * Where a floating layer is drawn: its whole box when it fills it (a bar on
 * its own background), or else only its text and controls (a bare wrapper
 * around a floating button).
 */
function extentOf(layer: Element, pieces: Piece[]): Box[] {
  if (fills(layer)) return [toBox(layer.getBoundingClientRect())]
  return pieces.filter((p) => p.layer === layer).map((p) => p.box)
}

/**
 * Floating layers drawn over each other, at any scroll: two fixed bars, or a
 * held sticky bar and the tab bar. One inside the other (a sheet's own sticky
 * header) is that layer's page, and passes under it by design.
 */
function layersOverLayers(pieces: Piece[]): string[] {
  const layers = [...new Set(pieces.flatMap((p) => (p.layer ? [p.layer] : [])))]
  const extents = new Map(layers.map((layer) => [layer, extentOf(layer, pieces)]))
  return layers.flatMap((a, i) =>
    layers
      .slice(i + 1)
      .filter((b) => apart(a, b))
      .filter((b) =>
        extents.get(a)!.some((box) => extents.get(b)!.some((other) => overlaps(box, other))),
      )
      .map((b) => `${describe(a)} is drawn over ${describe(b)}`),
  )
}

/**
 * Lines with a filled box over them, but not where text in that box is drawn
 * over the line: that is already one overlap, and named once.
 */
function coveredText(texts: Piece[], collided: [Element, Element][]): string[] {
  const textOver = (owner: Element, cover: Element) =>
    collided.some(
      ([a, b]) => (a === owner && cover.contains(b)) || (b === owner && cover.contains(a)),
    )
  return findCoveredText(texts)
    .filter(({ owner, cover }) => !textOver(owner, cover))
    .map(({ owner, cover }) => `${describe(owner)} is covered by ${describe(cover)}`)
}

export function findOverlaps(): LayoutProblem[] {
  const texts = textPieces()
  const pieces = [...texts, ...controlPieces()]
  // Each pair of elements once, however many of their lines meet.
  const collided: [Element, Element][] = []
  pieces.forEach((a, i) => {
    for (const b of pieces.slice(i + 1)) if (collide(a, b)) collided.push([a.owner, b.owner])
  })
  const messages = new Set([
    ...collided.map(([a, b]) => `${describe(a)} overlaps ${describe(b)}`),
    ...underBars(pieces),
    ...layersOverLayers(pieces),
    ...coveredText(texts, collided),
  ])
  return [...messages].map((message) => ({ check: 'overlap', message }))
}
