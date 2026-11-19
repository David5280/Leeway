// Controls a finger can miss. Every control on the page (CONTROLS) must take
// a tap TAP pixels across, centred on it: probed at its four edges, each must
// land on the control, on a label for it, or on a hit area it draws around
// itself (a ::before), and not on a neighbour drawn over it. And no other
// control's hit area may reach over it: walked along its own edges, a tap
// must never land on another control whose box is elsewhere. Each control is
// scrolled into view first, so one below the fold is checked like the rest;
// one that cannot be scrolled into view (placed off the page) cannot be
// tapped at all. Controls hidden on purpose are skipped, and so are links in
// running text, which a sentence carries and no layout can enlarge.

import { blockOf, CONTROLS, describe, isHiddenByDesign } from './elements'

/** The smallest comfortable tap for a finger, in CSS pixels (Apple's 44pt). */
export const TAP = 44

/** How far apart, in CSS pixels, the walk along a control's edges looks. */
const STEP = 4

/** How far inside a control's box its edges are walked, in CSS pixels. */
const INSET = 1.5

/** A point on the screen, in CSS pixels from its top left corner. */
type Point = [x: number, y: number]

/** Whether two line fragments sit on the same line: they share most of a line's height. */
function onSameLine(a: DOMRect, b: DOMRect): boolean {
  const shared = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return shared > Math.min(a.height, b.height) / 2
}

/**
 * A link inside a sentence: drawn inline, with words of its block outside it
 * on one of its lines. A link alone on its line (under a heading, after a
 * paragraph) is not, so it is checked like any other control.
 */
function inRunningText(control: Element): boolean {
  if (getComputedStyle(control).display !== 'inline') return false
  const lines = [...control.getClientRects()]
  const walker = document.createTreeWalker(blockOf(control), NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (control.contains(text) || !text.textContent?.trim()) continue
    range.selectNodeContents(text)
    const words = [...range.getClientRects()]
    if (words.some((word) => lines.some((line) => onSameLine(word, line)))) return true
  }
  return false
}

/*
 * elementFromPoint hit-tests the pixel-sized square whose top left corner is
 * the point, not the point alone: it finds what overlaps [x, x + 1). So a
 * probe tells apart where a hit area ends only to the pixel, and the probes
 * below are placed with that square in mind.
 */

/** The control a point lands on, if any, and the element it hit. */
function hitAt(x: number, y: number): { hit: Element; control: Element | null } | null {
  const hit = document.elementFromPoint(x, y)
  return hit ? { hit, control: hit.closest(CONTROLS) } : null
}

/** Whether a hit counts as a tap on the control: on it, or on one of its labels. */
function isOn(control: Element, hit: Element): boolean {
  if (control.contains(hit)) return true
  const labels =
    'labels' in control ? (control.labels as NodeListOf<HTMLLabelElement> | null) : null
  return [...(labels ?? [])].some((label) => label.contains(hit))
}

/**
 * Whether a tap TAP across, centred on the control as it now shows, lands on
 * it at each of the tap's four edges. Its hit area must reach to within half
 * a pixel of each edge, which a hit area of exactly TAP does wherever it
 * sits and one a pixel short never does (taps.phone.spec.ts), and nothing
 * else may be drawn over it inside the tap.
 */
function takesTap(control: Element): boolean {
  const r = control.getBoundingClientRect()
  const [x, y] = [r.left + r.width / 2, r.top + r.height / 2]
  const half = TAP / 2
  // A tap stops at the screen's edge, so a hit area that reaches it is enough.
  const onScreen = ([px, py]: Point): Point => [
    Math.min(Math.max(px, 0), innerWidth - 1),
    Math.min(Math.max(py, 0), innerHeight - 1),
  ]
  // Squares that straddle each edge by half a pixel: the control must be
  // among what they overlap, though a neighbour that starts at the edge may
  // be drawn on top there.
  const straddling: Point[] = [
    [x - half - 0.5, y],
    [x + half - 0.5, y],
    [x, y - half - 0.5],
    [x, y + half - 0.5],
  ]
  const reaches = straddling
    .map(onScreen)
    .every(([px, py]) => document.elementsFromPoint(px, py).some((hit) => isOn(control, hit)))
  // Squares just inside each edge: there the control must be on top.
  const inside: Point[] = [
    [x - half, y],
    [x + half - 1, y],
    [x, y - half],
    [x, y + half - 1],
  ]
  const onTop = inside.map(onScreen).every(([px, py]) => {
    const found = hitAt(px, py)
    return found !== null && isOn(control, found.hit)
  })
  return reaches && onTop
}

/** Points along a box's edges, INSET inside it and STEP apart, within the screen. */
function edgePoints(r: DOMRect): Point[] {
  // The square each point stands for reaches a pixel right and down of it.
  const [left, right] = [r.left + INSET, r.right - INSET - 1]
  const [top, bottom] = [r.top + INSET, r.bottom - INSET - 1]
  const along = (from: number, to: number) => {
    const count = Math.max(1, Math.floor((to - from) / STEP))
    return Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count)
  }
  const points: Point[] = [
    ...along(left, right).flatMap((x): Point[] => [
      [x, top],
      [x, bottom],
    ]),
    ...along(top, bottom).flatMap((y): Point[] => [
      [left, y],
      [right, y],
    ]),
  ]
  return points.filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight)
}

/**
 * The control whose hit area reaches over this one's edges: one a tap on the
 * edge lands on though its own box is elsewhere. A control drawn over this
 * one, its box there too, is the overlap check's to name.
 */
function stealerOf(control: Element): Element | null {
  for (const [x, y] of edgePoints(control.getBoundingClientRect())) {
    const found = hitAt(x, y)
    if (!found?.control || isOn(control, found.hit) || found.control.contains(control)) continue
    const box = found.control.getBoundingClientRect()
    const inBox = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
    if (!inBox) return found.control
  }
  return null
}

/** What is wrong with a control's tap, if anything, as it now shows. */
function tapProblem(control: Element): string | null {
  const { width, height } = control.getBoundingClientRect()
  const size = `(${Math.round(width)}x${Math.round(height)})`
  if (!takesTap(control)) return `${describe(control)} misses a ${TAP}px tap ${size}`
  const stealer = stealerOf(control)
  if (stealer) return `${describe(control)} loses taps to ${describe(stealer)}'s hit area`
  return null
}

/**
 * Each control on the page a finger can miss, named, with its box. This
 * scrolls the page and any scrolling boxes, so run it after the checks that
 * need the page where it was.
 */
export function findMissedTaps(): string[] {
  return [...document.querySelectorAll(CONTROLS)].flatMap((control) => {
    if (isHiddenByDesign(control) || inRunningText(control)) return []
    control.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    const problem = tapProblem(control)
    return problem ? [problem] : []
  })
}
