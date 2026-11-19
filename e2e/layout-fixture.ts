// A bare page to prove the layout guard's checks on (layout-checks.spec.ts,
// layout-clipped.spec.ts and taps.phone.spec.ts).

import type { Page } from '@playwright/test'
import { findProblems, type LayoutCheck } from './layout'

/**
 * A bare page at phone width: system font, no margins, the given body. It
 * takes the screen's width as the app does, so a phone draws it at 1:1
 * rather than as a 980px page shrunk to fit.
 */
export async function fixture(page: Page, body: string, css = ''): Promise<void> {
  await page.setContent(`<!doctype html>
    <html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { margin: 0; font: 16px/1.4 sans-serif; }
      ${css}
    </style></head><body>${body}</body></html>`)
}

/** The messages one check finds. */
export const found = async (page: Page, check: LayoutCheck) =>
  (await findProblems(page, check)).map((problem) => problem.message)
