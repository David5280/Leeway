// (c) A word split across two lines. A label's words never break; a long code
// or address may wrap only when it is wider than its whole line. Text set to
// break anywhere on purpose (a value to copy) is left alone.

import { blockOf, describe, isSvg, lineWidth } from './elements'
import { height, TOUCHING, width } from './geometry'
import { lineBoxes, textNodes } from './text'
import type { LayoutProblem } from './types'

/** Words up to this long are labels and must never break; longer ones are codes or addresses. */
const LONGEST_LABEL_WORD = 24

/** A word: what a line may not end inside. Lines may end after a space, hyphen, dash, slash or zero-width space. */
const WORD = /[^\s\-\u2010-\u2015/\u200b]{2,}/g

export function findBrokenWords(): LayoutProblem[] {
  const problems: LayoutProblem[] = []
  const range = document.createRange()
  for (const { node, owner } of textNodes()) {
    if (isSvg(owner) || getComputedStyle(owner).wordBreak === 'break-all') continue
    const line = lineWidth(blockOf(owner))
    for (const match of node.data.matchAll(WORD)) {
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      const boxes = lineBoxes(range)
      const first = boxes[0]
      // On one line, every piece starts at the first one's height.
      if (!first || boxes.every((b) => Math.abs(b.top - first.top) < height(first) / 2)) continue
      const drawnWidth = boxes.reduce((sum, b) => sum + width(b), 0)
      if (match[0].length > LONGEST_LABEL_WORD && drawnWidth > line + TOUCHING) continue
      problems.push({
        check: 'broken-word',
        message: `"${match[0]}" breaks across lines in ${describe(owner)}`,
      })
    }
  }
  return problems
}
