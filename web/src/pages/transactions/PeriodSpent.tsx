// The Transactions screen's hero: what has gone out this period, against the
// same point in the last one, opening the math behind it (lib/drills/budget.ts).
// The list below may cover another range; this figure always speaks for the
// current period.

import type { Budget } from '../../api/client'
import { useAction } from '../../api/hooks'
import { Card } from '../../components/design/Card'
import { HeroFigure } from '../../components/design/HeroFigure'
import { useApp } from '../../lib/app'
import { spendingUsual, spentDrill } from '../../lib/drills/budget'
import { periodWord } from '../../lib/format'

export function PeriodSpent({ budget }: { budget: Budget }) {
  const { settings } = useApp()
  const word = periodWord(settings.period.kind)
  // The trend is a nicety: the figure shows without it.
  const trends = useAction('get_trends', { periods: 6 })
  const label = `Spent this ${word}`
  return (
    <Card drill={spentDrill(budget, word, trends.data)} label={label} className="hero">
      <HeroFigure
        label={label}
        cents={budget.totals.spentCents}
        usual={spendingUsual(budget, word)}
      />
    </Card>
  )
}
