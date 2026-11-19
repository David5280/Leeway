// What the checks need to know about an element as the browser drew it:
// where it may show, whether it shows at all, and a name for messages.

import { EVERYWHERE, height, intersect, NOWHERE, toBox, width, type Box } from './geometry'

/** Anything a person can tap, type in or focus. */
export const CONTROLS = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** The box an element's content is drawn and clipped in: inside its borders. */
export function paddingBox(el: Element): Box {
  const r = el.getBoundingClientRect()
  const left = r.left + el.clientLeft
  const top = r.top + el.clientTop
  return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }
}

/** Whether a node clips what is inside it, or hides it entirely (null). */
function clipOf(node: Element): Box | null | undefined {
  if (node === document.body || node === document.documentElement) return undefined
  const style = getComputedStyle(node)
  // The clip property on an absolute box is how text is hidden visually.
  if (style.clip !== 'auto' && style.position === 'absolute') return null
  if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return paddingBox(node)
  return undefined
}

/**
 * The area an element can show through: the intersection of every ancestor
 * that clips (overflow other than visible, or the clip property, as on
 * visually hidden text). A fixed element escapes its ancestors' clipping.
 * With `ownText`, the element's own overflow clips too, as it does the text
 * inside it (a name ending in an ellipsis is drawn only up to its box).
 */
export function clipArea(el: Element, ownText = false): Box {
  let area = EVERYWHERE
  for (let node: Element | null = el; node; node = node.parentElement) {
    const clip = node === el && !ownText ? undefined : clipOf(node)
    if (clip === null) return NOWHERE
    if (clip) area = intersect(area, clip)
    if (getComputedStyle(node).position === 'fixed') break
  }
  return area
}

/** Shown on the page: rendered, not see-through, and bigger than a 1px hiding box. */
export function isShown(el: Element): boolean {
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
  const r = el.getBoundingClientRect()
  if (r.width <= 1 || r.height <= 1) return false
  const area = intersect(toBox(r), clipArea(el))
  return width(area) > 1 && height(area) > 1
}

/** The part of an element that shows, after its ancestors' clipping. */
export const shownBox = (el: Element): Box =>
  intersect(toBox(el.getBoundingClientRect()), clipArea(el))

/** The fixed bar (like the tab bar) an element is inside, which floats over the page. */
export function layerOf(el: Element): Element | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (getComputedStyle(node).position === 'fixed') return node
  }
  return null
}

/** The first ancestor (or the element) laid out as a box rather than a run of inline text. */
export function blockOf(el: Element): Element {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const display = getComputedStyle(node).display
    if (display !== 'inline' && display !== 'contents') return node
  }
  return document.body
}

/** The width a block's lines run across: inside its padding. */
export function lineWidth(block: Element): number {
  const style = getComputedStyle(block)
  return block.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
}

/** Part of a chart, which places its own labels. */
export const isSvg = (el: Element) => el instanceof SVGElement

/** A short name for an element in a message: tag, id, classes and its first words. */
export function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : ''
  const classes = [...el.classList].map((name) => `.${name}`).join('')
  const label = el.getAttribute('aria-label')
  const text = (label ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return `<${el.tagName.toLowerCase()}${id}${classes}>${text ? ` "${text}"` : ''}`
}

/** How see-through a CSS color is: 0 clear, 1 solid. */
export function alphaOf(color: string): number {
  if (color === 'transparent') return 0
  const parts = color.match(/[\d.]+/g)
  if (!parts) return 1
  return color.startsWith('rgba') || color.includes('/') ? Number(parts[3] ?? 1) : 1
}
