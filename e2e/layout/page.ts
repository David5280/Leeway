// The layout checks as they run inside the page: layout.ts bundles this file
// and everything it imports into one script for the browser.

import { findBrokenWords } from './broken-word'
import { findClippedText } from './clipped'
import { findOverlaps } from './overlap'
import { findPageOverflow } from './page-overflow'
import { findUncoveredInsets } from './safe-area'
import type { LayoutCheck, LayoutProblem } from './types'

const CHECKS: Record<LayoutCheck, () => LayoutProblem[]> = {
  overlap: findOverlaps,
  clipped: findClippedText,
  'broken-word': findBrokenWords,
  'page-overflow': findPageOverflow,
  'safe-area': findUncoveredInsets,
}

/** Runs one check on the page as it is drawn now. */
export const measure = (check: LayoutCheck): LayoutProblem[] => CHECKS[check]()
