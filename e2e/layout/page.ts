// The layout checks as they run inside the page: layout.ts bundles this file
// and everything it imports into one script for the browser.

import { findBrokenWords } from './broken-word'
import { findClipped } from './clipped'
import { findOverlaps } from './overlap'
import { findPageOverflow } from './page-overflow'
import { findUncoveredInsets } from './safe-area'
import { LAYOUT_CHECKS, type LayoutCheck, type LayoutProblem } from './types'

/** Each check's finder, one for every name in LAYOUT_CHECKS (the type makes sure). */
const CHECKS: Record<LayoutCheck, () => LayoutProblem[]> = {
  overlap: findOverlaps,
  clipped: findClipped,
  'broken-word': findBrokenWords,
  'page-overflow': findPageOverflow,
  'safe-area': findUncoveredInsets,
}

/** Runs one check on the page as it is drawn now. */
export function measure(check: LayoutCheck): LayoutProblem[] {
  if (!LAYOUT_CHECKS.includes(check)) throw new Error(`No layout check named ${check}`)
  return CHECKS[check]()
}
