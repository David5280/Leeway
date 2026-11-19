// The text drawn on the page, as the line boxes the browser laid it out in.

import { alphaOf, clipArea, isHiddenByDesign } from './elements'
import { cornersOf, height, intersect, toBox, union, width, type Box, type Point } from './geometry'

/**
 * A text box runs from the font's ascent to its descent, taller than the
 * letters. Each line's box is trimmed by this share of its height at the top
 * and bottom, so lines set close together do not count as overlapping.
 */
export const LINE_TRIM = 0.12

/** Where text lives in markup but is not drawn as text on the page. */
const NOT_TEXT = [
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'select',
  'option',
  'optgroup',
  'title',
].join(',')

/**
 * Whether an element's text is painted at all: not hidden by design, and in
 * a color that is not fully transparent (as text under a custom control can be).
 */
function paintsText(owner: Element): boolean {
  return !isHiddenByDesign(owner) && alphaOf(getComputedStyle(owner).color) > 0
}

/**
 * Every text node drawn on the page, with the element holding it. Text counts
 * wherever its letters reach the screen, even when the layout squeezed its
 * element to nothing; text scrolled out of a sideways row does not.
 */
export function textNodes(): { node: Text; owner: Element }[] {
  const found: { node: Text; owner: Element }[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  // Many text nodes share an owner, so what it paints and where is worked out once.
  const painted = new Map<Element, boolean>()
  const areas = new Map<Element, Box>()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement
    if (!owner || !node.textContent?.trim() || owner.closest(NOT_TEXT)) continue
    if (!painted.has(owner)) painted.set(owner, paintsText(owner))
    if (!painted.get(owner)) continue
    if (!areas.has(owner)) areas.set(owner, clipArea(owner))
    range.selectNodeContents(node)
    const lines = lineBoxes(range)
    const onScreen = lines.length > 0 && intersect(union(lines), areas.get(owner)!)
    if (onScreen && width(onScreen) > 1 && height(onScreen) > 1) {
      found.push({ node: node as Text, owner })
    }
  }
  return found
}

/** The line boxes a range of text is drawn in, one per line. */
export function lineBoxes(range: Range): Box[] {
  return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5).map(toBox)
}

/** Each element's text, as the line boxes of its own text (not its children's). */
export function texts(): { owner: Element; lines: Box[] }[] {
  const byOwner = new Map<Element, Box[]>()
  const range = document.createRange()
  for (const { node, owner } of textNodes()) {
    range.selectNodeContents(node)
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), ...lineBoxes(range)])
  }
  return [...byOwner].map(([owner, lines]) => ({ owner, lines })).filter((t) => t.lines.length)
}

/**
 * A chart label turned at an angle (like "Steady pace" along a slope): the
 * four corners of its own box, turned as it is drawn, trimmed like a line of
 * text. Upright text gives null; its line boxes are exact already.
 */
export function turnedTextCorners(owner: Element): Point[] | null {
  if (!(owner instanceof SVGGraphicsElement)) return null
  const matrix = owner.getScreenCTM()
  if (!matrix || (Math.abs(matrix.b) < 1e-6 && Math.abs(matrix.c) < 1e-6)) return null
  const box = owner.getBBox()
  const trim = box.height * LINE_TRIM
  return cornersOf({
    left: box.x,
    top: box.y + trim,
    right: box.x + box.width,
    bottom: box.y + box.height - trim,
  }).map(({ x, y }) => ({
    // getScreenCTM maps the label's own units to the viewport.
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }))
}
