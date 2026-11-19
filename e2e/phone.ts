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

/** The smallest a finger target may be, as --tap in tokens.css says. */
export const TAP_PX = 44

/**
 * Every visible control under `root` shorter than a finger, as "name: 36px",
 * so a failure says which. A control may reach --tap with an invisible
 * absolutely placed ::after around it (the sheet's close button does), so
 * that margin counts toward its height.
 */
export function shortTargets(page: Page, root: string): Promise<string[]> {
  return page.evaluate(
    ({ root, tap }) => {
      const controls = document.querySelectorAll<HTMLElement>(
        `${root} :is(button, a[href], input, select, textarea, [role="switch"])`,
      )
      return [...controls].flatMap((control) => {
        const box = control.getBoundingClientRect()
        if (box.width === 0 && box.height === 0) return []
        const after = getComputedStyle(control, '::after')
        const reach =
          after.content !== 'none' && after.position === 'absolute'
            ? Math.max(0, -parseFloat(after.top)) + Math.max(0, -parseFloat(after.bottom))
            : 0
        const height = Math.round((box.height + reach) * 10) / 10
        if (height >= tap) return []
        const name =
          control.getAttribute('aria-label') ??
          control.getAttribute('placeholder') ??
          control.textContent?.trim()
        return [`${name}: ${height}px`]
      })
    },
    { root, tap: TAP_PX },
  )
}

/**
 * Every pair of words under `root` drawn on top of each other, as "A / B",
 * so a failure says what ran into what. Each run of text is measured where
 * the browser actually drew it, line by line, and only as far as it shows
 * (a name cut off with "…" ends where it is cut), so it covers any layout.
 */
export function textOverlaps(page: Page, root: string): Promise<string[]> {
  return page.evaluate((root) => {
    /** The box text is cut off at, as a name ending in "…" is: its nearest clipping ancestor. */
    const clipOf = (element: Element | null): DOMRect | null => {
      for (let at = element; at; at = at.parentElement) {
        if (getComputedStyle(at).overflowX !== 'visible') return at.getBoundingClientRect()
      }
      return null
    }
    /** The part of a box inside another; empty when they do not meet. */
    const within = (box: DOMRect, clip: DOMRect) => {
      const left = Math.max(box.left, clip.left)
      const top = Math.max(box.top, clip.top)
      const right = Math.min(box.right, clip.right)
      const bottom = Math.min(box.bottom, clip.bottom)
      return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
    }
    const walker = document.createTreeWalker(document.querySelector(root)!, NodeFilter.SHOW_TEXT)
    const runs: { text: string; boxes: DOMRect[] }[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent!.trim()
      if (!text) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const clip = clipOf(node.parentElement!)
      const boxes = [...range.getClientRects()]
        .map((box) => (clip ? within(box, clip) : box))
        .filter((box) => box.width > 0 && box.height > 0)
      if (boxes.length) runs.push({ text, boxes })
    }
    // Half a pixel either way is rounding, not an overlap.
    const meet = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5
    const problems: string[] = []
    runs.forEach((run, index) => {
      for (const other of runs.slice(index + 1)) {
        if (run.boxes.some((box) => other.boxes.some((theirs) => meet(box, theirs))))
          problems.push(`${run.text} / ${other.text}`)
      }
    })
    return problems
  }, root)
}
