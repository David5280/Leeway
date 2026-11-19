// Shared pieces for the phone browser tests: screen sizes, the sideways-scroll
// check and simulated iPhone safe areas.

import type { Page } from '@playwright/test'

/** An iPhone 16 Pro, upright. */
export const IPHONE = { viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true }
/** The same iPhone turned sideways. */
export const IPHONE_LANDSCAPE = { ...IPHONE, viewport: { width: 874, height: 402 } }
/** The narrowest phone still in use: an iPhone SE, first generation. */
export const NARROWEST = { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }

/** Safe-area insets in pixels, as an iPhone with a Dynamic Island reports them. */
export const UPRIGHT_INSETS = { top: 62, right: 0, bottom: 34, left: 0 }
export const SIDEWAYS_INSETS = { top: 0, right: 62, bottom: 21, left: 62 }

/**
 * Stands in for an iPhone's safe-area insets. A browser test cannot fake
 * env(safe-area-inset-*), so this sets the CSS variables that styles.css
 * reads them through (--sat, --sar, --sab, --sal).
 */
export async function simulateInsets(page: Page, insets: typeof UPRIGHT_INSETS): Promise<void> {
  const { top, right, bottom, left } = insets
  await page.addStyleTag({
    content: `:root { --sat: ${top}px; --sar: ${right}px; --sab: ${bottom}px; --sal: ${left}px; }`,
  })
}

/** How far the page is wider than the screen; above zero means it scrolls sideways. */
export const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
