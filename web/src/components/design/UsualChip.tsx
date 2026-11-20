// A figure against its usual in a few characters, "▼ $40 less spent", on a tinted
// chip beside a hero number. The arrow and the word carry the meaning, the
// tint only repeats it; the full sentence is what a screen reader hears.

import { useApp } from '../../lib/app'
import { compareToUsual, usualSentence, type DrillUsual } from '../../lib/drill'

export function UsualChip({ usual }: { usual: DrillUsual }) {
  const { money } = useApp()
  const comparison = compareToUsual(usual)
  const words =
    comparison.direction === 'same'
      ? 'as usual'
      : [money(comparison.differenceCents), comparison.direction, usual.subject]
          .filter(Boolean)
          .join(' ')
  return (
    <span
      className={`usual-chip usual-${comparison.tone}`}
      role="img"
      aria-label={usualSentence(usual, money)}
    >
      <span aria-hidden="true">{comparison.arrow}</span> {words}
    </span>
  )
}
