// Shared pieces for the phone browser tests: screen sizes, the sideways-scroll
// and overlap checks, and simulated iPhone safe areas.

import type { Locator, Page } from '@playwright/test'

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

/** The phone sizes a screen must fit: iPhones upright, the narrowest phone, and sideways. */
export const PHONES = [
  ['an iPhone 390px across', { width: 390, height: 844 }],
  ['an iPhone 375px across', { width: 375, height: 667 }],
  ['the narrowest phone', { width: 320, height: 568 }],
  ['an iPhone turned sideways', { width: 844, height: 390 }],
] as const

/** Safe-area insets in pixels, as an iPhone with a Dynamic Island reports them. */
export const UPRIGHT_INSETS = { top: 62, right: 0, bottom: 34, left: 0 }
export const SIDEWAYS_INSETS = { top: 0, right: 62, bottom: 21, left: 62 }

export type Insets = typeof UPRIGHT_INSETS

/** Up to this width the app uses its phone layout (styles.css), with the tab bar. */
export const PHONE_LAYOUT_WIDTH = 820

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

/** Every element's box, so overlaps and sizes can be checked. */
export async function boxes(elements: Locator) {
  const all = await elements.all()
  return Promise.all(all.map(async (element) => (await element.boundingBox())!))
}

type Box = Awaited<ReturnType<typeof boxes>>[number]

/** Whether two boxes share any area; touching edges do not count. */
export const overlapping = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5
