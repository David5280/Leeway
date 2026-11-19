// What the layout checks report, shared by the checks in the page and the
// tests that read them.

export type LayoutCheck = 'overlap' | 'clipped' | 'broken-word' | 'page-overflow' | 'safe-area'

export interface LayoutProblem {
  check: LayoutCheck
  /** What is wrong and where, in words, naming the elements involved. */
  message: string
}
