// Layout checks for the phone layout guard (layout-guard.phone.spec.ts):
// each finds one kind of broken layout on the page as it is drawn, and says
// where. layout-checks.spec.ts and layout-clipped.spec.ts prove each one on a
// page broken on purpose.
//
//   overlap        text drawn over other text or over a control
//   clipped        text cut off, or spilling out of its box, with no ellipsis;
//                  a control cut off by a box that clips it
//   broken-word    a short word split across two lines ("Sur" / "plus")
//   page-overflow  the page is wider than the screen, so it scrolls sideways
//   safe-area      something drawn under the status bar, the notch or the home
//                  indicator that nothing opaque (like the status bar backdrop)
//                  covers
//
// missedTaps, apart from these, finds controls too small for a finger.
//
// The checks measure what the browser drew (boxes, text line boxes, what sits
// on top at a point), never class names, so they hold for any screen and any
// theme. They live in layout/, one file per check, and run inside the page:
// this module bundles them into one script and has the page run it.

import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import type { Page } from '@playwright/test'
import { LAYOUT_CHECKS, type LayoutCheck, type LayoutProblem } from './layout/types'

export { LAYOUT_CHECKS, type LayoutCheck, type LayoutProblem }

let script: string | undefined

/**
 * layout/page.ts and what it imports, as one script that leaves `layout.measure`
 * and `layout.missedTaps` defined. Bundled once per test run, on first use.
 */
function pageScript(): string {
  script ??= buildSync({
    entryPoints: [fileURLToPath(new URL('./layout/page.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    globalName: 'layout',
    target: 'chrome120',
    write: false,
  }).outputFiles[0]!.text
  return script
}

/** Runs one check on the page as it is drawn now. */
export function findProblems(page: Page, check: LayoutCheck): Promise<LayoutProblem[]> {
  // Run in a function of its own, so the bundle's names stay out of the page's globals.
  return page.evaluate(`(() => {
    ${pageScript()}
    return layout.measure(${JSON.stringify(check)})
  })()`)
}

/** Runs every check on the page as it is drawn now. */
export async function layoutProblems(page: Page): Promise<LayoutProblem[]> {
  const found: LayoutProblem[] = []
  for (const check of LAYOUT_CHECKS) found.push(...(await findProblems(page, check)))
  return found
}

/**
 * Each control on the page a finger can miss (layout/taps.ts), named. It
 * scrolls every control into view to probe it, so the page is left scrolled.
 */
export function missedTaps(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    ${pageScript()}
    return layout.missedTaps()
  })()`)
}

/** Problems as one line each, for a readable test failure. */
export const describeProblems = (problems: LayoutProblem[]): string[] =>
  problems.map(({ check, message }) => `${check}: ${message}`)
