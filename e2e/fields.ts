// Checks that form fields are big enough on a phone. iOS zooms in on any field
// under 16px when it gets focus, and an app installed to the home screen keeps
// that zoom, which leaves every card wider than the screen.

import { expect, type Page } from '@playwright/test'

/** The smallest field font iOS leaves alone. */
const MIN_FIELD_PX = 16

/** Every input, select and textarea on the page whose font is under 16px, named for the failure message. */
export const smallFields = (page: Page) =>
  page.locator('input:not([type="hidden"]), select, textarea').evaluateAll(
    (fields: HTMLInputElement[], min) =>
      fields
        .map((field) => ({
          field:
            field.getAttribute('aria-label') ??
            field.labels?.[0]?.textContent?.trim() ??
            field.outerHTML.slice(0, 80),
          fontSize: parseFloat(getComputedStyle(field).fontSize),
        }))
        .filter((found) => found.fontSize < min),
    MIN_FIELD_PX,
  )

/**
 * Checks the fields at a phone's width, for a test that otherwise runs on a
 * desktop, then puts the window back as it was.
 */
export async function expectPhoneSizedFields(page: Page): Promise<void> {
  const desktop = page.viewportSize()!
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => smallFields(page)).toEqual([])
  await page.setViewportSize(desktop)
}
