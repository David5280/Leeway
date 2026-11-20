// What the layout checks are and what they report, shared by the checks in
// the page and the tests that run them.

/** Every check, in the order layoutProblems runs them. */
export const LAYOUT_CHECKS = [
  'overlap',
  'clipped',
  'broken-word',
  'page-overflow',
  'safe-area',
  'spill',
  'sticky-hover',
] as const

export type LayoutCheck = (typeof LAYOUT_CHECKS)[number]

export interface LayoutProblem {
  check: LayoutCheck
  /** What is wrong and where, in words, naming the elements involved. */
  message: string
}
