// Controls a finger can miss. Every control on the page (CONTROLS) must take
// a tap TAP pixels across, centred on it: probed at its four edges, each must
// land on the control, on a label for it, or on a hit area it draws around
// itself (a ::before), and not on a neighbour drawn over it. Each control is
// scrolled into view first, so one below the fold is checked like the rest;
// one that cannot be scrolled into view (placed off the page) cannot be
// tapped at all. Controls hidden on purpose are skipped, and so are links in
// running text, which a sentence carries and no layout can enlarge.

import { blockOf, CONTROLS, describe, isHiddenByDesign } from './elements'

/** The smallest comfortable tap for a finger, in CSS pixels (Apple's 44pt). */
export const TAP = 44

/** A link inside a sentence: drawn inline, with other words in its block. */
function inRunningText(control: Element): boolean {
  if (getComputedStyle(control).display !== 'inline') return false
  const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  return words(blockOf(control)).length > words(control).length
}

/** Whether a tap at a point reaches the control: on it, or on one of its labels. */
function reaches(control: Element, x: number, y: number): boolean {
  const hit = document.elementFromPoint(x, y)
  if (!hit) return false
  if (control.contains(hit)) return true
  const labels =
    'labels' in control ? (control.labels as NodeListOf<HTMLLabelElement> | null) : null
  return [...(labels ?? [])].some((label) => label.contains(hit))
}

/** Whether a tap TAP across, centred on the control as it now shows, lands on it. */
function takesTap(control: Element): boolean {
  const r = control.getBoundingClientRect()
  const [x, y] = [r.left + r.width / 2, r.top + r.height / 2]
  // Hit testing snaps a box to whole pixels, which can move an edge by up to
  // half a pixel, so each probe goes a pixel and a half inside the tap's
  // edge: a hit area of exactly TAP passes wherever it sits, and one 3px or
  // more short of it never does (taps.phone.spec.ts).
  const reach = TAP / 2 - 1.5
  return (
    reaches(control, x - reach, y) &&
    reaches(control, x + reach, y) &&
    reaches(control, x, y - reach) &&
    reaches(control, x, y + reach)
  )
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
    if (takesTap(control)) return []
    const { width, height } = control.getBoundingClientRect()
    return [
      `${describe(control)} misses a ${TAP}px tap (${Math.round(width)}x${Math.round(height)})`,
    ]
  })
}
