// The Transactions screen's main number: what has gone out this period, with
// how that compares to the same point in the last one. The list below may
// cover another range; this figure always speaks for the current period.

import type { Budget } from '../../api/client'
import { KeyFigure } from '../../components/design/KeyFigure'
import { SpentComparison } from '../../components/SpentComparison'
import { useApp } from '../../lib/app'
import { periodWord } from '../../lib/format'

export function PeriodSpent({ budget }: { budget: Budget }) {
  const { settings } = useApp()
  const word = periodWord(settings.period.kind)
  return (
    <KeyFigure
      label={`Spent this ${word}`}
      cents={budget.totals.spentCents}
      caption={<SpentComparison totals={budget.totals} previous={budget.previous} word={word} />}
    />
  )
}
