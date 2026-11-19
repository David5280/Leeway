// (e) The safe areas: the status bar and Dynamic Island at the top, the notch
// at a side turned sideways, the home indicator at the bottom. Under the
// status bar nothing may show at all, so scrolled content needs an opaque
// backdrop over it. At the sides and bottom only text and controls must stay
// clear; backgrounds (the tab bar's) may run to the edge.

import { alphaOf, CONTROLS, describe, isShown, layerOf, shownBox } from './elements'
import {
  height,
  intersect,
  isScrolledToEnd,
  TOUCHING,
  viewport,
  width,
  type Box,
  type Point,
} from './geometry'
import type { LayoutProblem } from './types'

/** The opacity from which a background hides what is under it. */
const OPAQUE = 0.85

/** Elements that draw something even with no text and no background. */
const DRAWN = new Set(['IMG', 'svg', 'CANVAS', 'VIDEO', 'IFRAME', 'INPUT', 'SELECT', 'TEXTAREA'])

/** A strip of the screen something covers, like the status bar. */
interface Band {
  name: string
  box: Box
  /** Whether backgrounds must keep clear too, not only text and controls. */
  anything: boolean
  /** Whether content scrolling past must keep clear, not only the fixed bars. */
  always: boolean
}

/** The insets as the page has them: env() through the --sa* variables, which tests override. */
function readInsets(): { top: number; right: number; bottom: number; left: number } {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:var(--sat) var(--sar) var(--sab) var(--sal)'
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const insets = {
    top: parseFloat(style.paddingTop),
    right: parseFloat(style.paddingRight),
    bottom: parseFloat(style.paddingBottom),
    left: parseFloat(style.paddingLeft),
  }
  probe.remove()
  return insets
}

/** The bands this screen has, now: none on a computer, some on a phone. */
function bands(): Band[] {
  const { top, right, bottom, left } = readInsets()
  const screen = viewport()
  // Content scrolls past the home indicator on its way up, as in any iPhone
  // app; only at the end of the page must it come to rest clear of it.
  const scrolledToEnd = isScrolledToEnd()
  const all: Band[] = [
    { name: 'the status bar', box: { ...screen, bottom: top }, anything: true, always: true },
    {
      name: 'the home indicator',
      box: { ...screen, top: screen.bottom - bottom },
      anything: false,
      always: scrolledToEnd,
    },
    { name: 'the left inset', box: { ...screen, right: left }, anything: false, always: true },
    {
      name: 'the right inset',
      box: { ...screen, left: screen.right - right },
      anything: false,
      always: true,
    },
  ]
  return all.filter(({ box }) => width(box) > 0 && height(box) > 0)
}

/** Has a background, border or shadow that shows. */
function paints(el: Element): boolean {
  const style = getComputedStyle(el)
  return (
    alphaOf(style.backgroundColor) > 0 ||
    style.backgroundImage !== 'none' ||
    style.boxShadow !== 'none' ||
    (parseFloat(style.borderTopWidth) > 0 && alphaOf(style.borderTopColor) > 0) ||
    (parseFloat(style.borderBottomWidth) > 0 && alphaOf(style.borderBottomColor) > 0)
  )
}

/** Draws something of its own: text, a picture or control, or with `anything`, a background. */
function draws(el: Element, anything: boolean): boolean {
  const hasText = [...el.childNodes].some(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
  )
  if (hasText || DRAWN.has(el.tagName) || el.matches(CONTROLS)) return true
  // A fixed bar is the app's own frame: its background may fill an inset (the
  // backdrop under the status bar, the tab bar over the home indicator); only
  // its text and controls must keep clear.
  return anything && !layerOf(el) && paints(el)
}

/** Three points across a strip, along its longer side. */
function pointsAcross(strip: Box): Point[] {
  const across = width(strip) >= height(strip)
  return [0.1, 0.5, 0.9].map((share) =>
    across
      ? { x: strip.left + width(strip) * share, y: (strip.top + strip.bottom) / 2 }
      : { x: (strip.left + strip.right) / 2, y: strip.top + height(strip) * share },
  )
}

/** Whether an element shows at a point with nothing opaque of another's over it. */
function uncoveredAt(el: Element, { x, y }: Point): boolean {
  const stack = document.elementsFromPoint(x, y)
  const at = stack.indexOf(el)
  // Not drawn at this point (a rounded corner, say): nothing to cover.
  if (at === -1) return false
  return !stack
    .slice(0, at)
    .some(
      (above) => !el.contains(above) && alphaOf(getComputedStyle(above).backgroundColor) >= OPAQUE,
    )
}

/** The part of an element inside a band that must be covered there, if any. */
function exposedPart(el: Element, band: Band): Box | null {
  const inside = intersect(shownBox(el), band.box)
  if (width(inside) <= TOUCHING || height(inside) <= TOUCHING) return null
  // Mid-scroll, only the fixed bars must keep clear of the home indicator.
  if (!band.always && !layerOf(el)) return null
  if (!draws(el, band.anything) || !isShown(el)) return null
  return inside
}

export function findUncoveredInsets(): LayoutProblem[] {
  const strips = bands()
  if (strips.length === 0) return []

  // Hit testing skips elements that ignore the pointer, like the backdrop
  // itself, so for this measurement every element takes part.
  const everyone = document.createElement('style')
  everyone.textContent = '*, *::before, *::after { pointer-events: auto !important; }'
  document.head.append(everyone)
  try {
    const elements = [...document.body.querySelectorAll('*')]
    return strips.flatMap((band) =>
      elements
        .filter((el) => {
          const part = exposedPart(el, band)
          return part !== null && pointsAcross(part).some((point) => uncoveredAt(el, point))
        })
        .map((el) => ({ check: 'safe-area', message: `${describe(el)} shows under ${band.name}` })),
    )
  } finally {
    everyone.remove()
  }
}
