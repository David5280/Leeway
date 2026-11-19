// Shared pieces for the phone browser tests: screen sizes, the sideways-scroll
// and tap-size checks, and simulated iPhone safe areas.

import type { Locator, Page } from '@playwright/test'
import { CONTROLS } from './layout/elements'

const phoneScreen = (width: number, height: number) =>
  ({ viewport: { width, height }, isMobile: true, hasTouch: true }) as const

/** An iPhone 16 Pro, upright. */
export const IPHONE = phoneScreen(402, 874)
/** The same iPhone turned sideways. */
export const IPHONE_LANDSCAPE = phoneScreen(874, 402)
/**
 * The narrowest screen to support: the first iPhone SE, 320pt wide. Apple
 * stopped selling it in 2018, but it is still in use. The narrowest iPhone
 * still sold is the later SE, at 375pt.
 */
export const NARROWEST = phoneScreen(320, 568)

/** Safe-area insets in pixels, as an iPhone with a Dynamic Island reports them. */
export const UPRIGHT_INSETS = { top: 62, right: 0, bottom: 34, left: 0 }
export const SIDEWAYS_INSETS = { top: 0, right: 62, bottom: 21, left: 62 }

export type Insets = typeof UPRIGHT_INSETS

/** Up to this width the app uses its phone layout (styles.css), with the tab bar. */
export const PHONE_LAYOUT_WIDTH = 820

/** The smallest comfortable tap for a finger, in CSS pixels (Apple's 44pt). */
export const TAP = 44

/** A phone the layout guard checks every screen on, installed to its home screen. */
export interface GuardedPhone {
  name: string
  screen: { viewport: { width: number; height: number }; isMobile: true; hasTouch: true }
  insets: Insets
  /**
   * Whether the overview is wide enough to be arranged in place (its Edit
   * layout button). Narrower screens arrange it in Settings, Appearance.
   */
  editsInPlace: boolean
}

const guarded = (name: string, width: number, height: number, insets: Insets): GuardedPhone => ({
  name,
  screen: phoneScreen(width, height),
  insets,
  editsInPlace: width > PHONE_LAYOUT_WIDTH,
})

/**
 * The layout guard's phones: the common 390pt iPhone and the 375pt iPhone SE
 * (the narrowest iPhone still sold), each upright and turned sideways, and
 * the narrowest screen supported (the first SE, 320pt) upright. Sideways
 * both get a notch's side insets, the harder case, though an SE has none.
 */
export const GUARDED_PHONES: readonly GuardedPhone[] = [
  guarded('an iPhone', 390, 844, { top: 47, right: 0, bottom: 34, left: 0 }),
  guarded('an iPhone SE', 375, 667, { top: 20, right: 0, bottom: 0, left: 0 }),
  guarded('the first iPhone SE', NARROWEST.viewport.width, NARROWEST.viewport.height, {
    top: 20,
    right: 0,
    bottom: 0,
    left: 0,
  }),
  guarded('an iPhone turned sideways', 844, 390, { top: 0, right: 47, bottom: 21, left: 47 }),
  guarded('an iPhone SE turned sideways', 667, 375, { top: 0, right: 47, bottom: 21, left: 47 }),
]

/**
 * Stands in for an iPhone's safe-area insets. A browser test cannot fake
 * env(safe-area-inset-*), so this sets the CSS variables that styles.css
 * reads them through (--sat, --sar, --sab, --sal).
 */
export async function simulateInsets(page: Page, insets: Insets): Promise<void> {
  const { top, right, bottom, left } = insets
  await page.addStyleTag({
    content: `:root { --sat: ${top}px; --sar: ${right}px; --sab: ${bottom}px; --sal: ${left}px; }`,
  })
}

/** How far the page is wider than the screen; above zero means it scrolls sideways. */
export const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/**
 * The controls in `area` a finger can miss, by name. A tap TAP pixels across,
 * centred on a control, must land on it at all four edges: on its own box or
 * a hit area drawn around it (a ::before), and on no neighbour's.
 */
export const missedTaps = (area: Locator) =>
  area.evaluate(
    (root, { controls, tap }) => {
      // A pixel inside the tap's edges, from a whole-pixel centre, since hit
      // testing works in whole pixels: a hit area of exactly TAP passes.
      const reach = tap / 2 - 1
      const landsOn = (control: Element, x: number, y: number) => {
        const hit = document.elementFromPoint(x, y)
        return hit !== null && control.contains(hit)
      }
      return [...root.querySelectorAll(controls)].flatMap((control) => {
        if (!control.checkVisibility()) return []
        const r = control.getBoundingClientRect()
        const [x, y] = [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]
        const lands =
          landsOn(control, x - reach, y) &&
          landsOn(control, x + reach, y) &&
          landsOn(control, x, y - reach) &&
          landsOn(control, x, y + reach)
        if (lands) return []
        return [
          control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.tagName,
        ]
      })
    },
    { controls: CONTROLS, tap: TAP },
  )

/** What a finger taps on any screen: buttons, icon buttons, segmented options and links in a nav. */
export const TAPPED = '.btn, .iconbtn, .seg button, nav a[href]'

/**
 * The TAPPED controls on the page smaller than TAP either way, by name and
 * size. Measured by their own boxes, so it holds wherever the page is
 * scrolled; a control hidden on purpose is left out.
 */
export const smallTaps = (page: Page) =>
  page.evaluate(
    ({ tapped, tap }) =>
      [...document.querySelectorAll(tapped)].flatMap((control) => {
        if (!control.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return []
        const { width, height } = control.getBoundingClientRect()
        // Half a pixel of rounding, as a 44px box can measure 43.99.
        if (width >= tap - 0.5 && height >= tap - 0.5) return []
        const name = control.getAttribute('aria-label') ?? control.textContent?.trim()
        return [`"${name}" is ${Math.round(width)}x${Math.round(height)}px`]
      }),
    { tapped: TAPPED, tap: TAP },
  )
