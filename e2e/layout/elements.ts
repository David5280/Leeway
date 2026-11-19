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

/** A length from a clip-path inset, in pixels: a percentage is of `whole`. */
const insetLength = (value: string, whole: number) =>
  value.endsWith('%') ? (parseFloat(value) / 100) * whole : parseFloat(value)

/**
 * Whether a clip-path leaves nothing of a box to see: an inset that meets in
 * the middle (inset(50%)), or a circle or ellipse of no size. A clip-path that
 * only shapes a box, like a popover's rounded corners, leaves it showing.
 */
function clipsToNothing(clipPath: string, box: DOMRect): boolean {
  if (/^(circle|ellipse)\(0(px|%)?[\s)]/.test(clipPath)) return true
  const inset = clipPath.match(/^inset\(([^)]*)\)/)
  if (!inset) return false
  // inset(top right bottom left round ...), each side defaulting as margins do.
  const [top = '0', right = top, bottom = top, left = right] = inset[1]!
    .split(' round ')[0]!
    .trim()
    .split(/\s+/)
  const across = insetLength(left, box.width) + insetLength(right, box.width)
  const down = insetLength(top, box.height) + insetLength(bottom, box.height)
  return across >= box.width || down >= box.height
}

/**
 * Tucked into a box for screen readers only: absolutely placed and clipped
 * away (the clip property, or a clip-path that leaves nothing), or shrunk to
 * a single pixel that hides its overflow (the .visually-hidden pattern).
 */
function isScreenReaderOnly(node: Element): boolean {
  const style = getComputedStyle(node)
  if (style.position !== 'absolute') return false
  const r = node.getBoundingClientRect()
  if (style.clip !== 'auto' || clipsToNothing(style.clipPath, r)) return true
  return r.width <= 1 && r.height <= 1 && style.overflowX !== 'visible'
}

/**
 * Hidden on purpose: not rendered, invisible or fully see-through, or inside
 * a screen-reader-only box. Something the layout merely squeezed to nothing
 * (a name in a 0px flex item) is not hidden by design, and the checks report it.
 */
export function isHiddenByDesign(el: Element): boolean {
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return true
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (isScreenReaderOnly(node)) return true
  }
  return false
}

/**
 * Shown on the page: not hidden by design, and with more than a pixel each
 * way left once its ancestors' clipping (a scrolling row, say) is applied.
 */
export function isShown(el: Element): boolean {
  if (isHiddenByDesign(el)) return false
  const area = shownBox(el)
  return width(area) > 1 && height(area) > 1
}

/** The part of an element that shows, after its ancestors' clipping. */
export function shownBox(el: Element): Box {
  return intersect(toBox(el.getBoundingClientRect()), clipArea(el))
}

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
