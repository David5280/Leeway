// A category's numbers for the current period: spent, budget, left and pace.

import type { Budget, Category, CategoryBudget } from '../../api/client'
import { Card, Progress } from '../../components/ui'
import { useApp } from '../../lib/app'
import { Money } from '../../components/design/Money'

type Period = Budget['period']

/**
 * What can still be spent each day, today included, without going over.
 * Null when there is no budget or the period is over.
 */
export function perDayLeft(leftCents: number | null, daysLeft: number): number | null {
  if (leftCents === null || daysLeft < 0) return null
  return Math.max(0, Math.floor(leftCents / (daysLeft + 1)))
}

export function ThisPeriod({
  category,
  row,
  period,
}: {
  category: Category
  row: CategoryBudget
  period: Period
}) {
  const { money } = useApp()
  const perDay = perDayLeft(row.leftCents, period.daysLeft)
  const isExpense = row.kind === 'expense'
  // The marker on the bar shows how far through the period today is.
  const todayMarker = row.pace !== null ? (period.daysElapsed / period.days) * 100 : null
  return (
    <Card label="This period" className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <Stat label={row.kind === 'income' ? 'Received' : 'Spent'} value={money(row.spentCents)} />
        <Stat label="Budget" value={row.budgetCents === null ? 'None' : money(row.budgetCents)} />
        <Stat label="Left" value={row.leftCents === null ? '' : money(row.leftCents)} />
        {isExpense && perDay !== null && <Stat label="Per day left" value={money(perDay)} />}
      </div>
      {row.budgetCents !== null && isExpense && (
        <Progress
          thick
          label={`${row.name} budget used`}
          percent={row.percentUsed ?? 0}
          color={row.status === 'over' ? 'var(--over-fill)' : category.color}
          marker={todayMarker}
        />
      )}
      <CarriedNote carriedCents={row.carriedCents} />
      {row.expectedByNowCents !== null && row.pace !== null && (
        <span className="small muted">
          Steady spending would be at <Money cents={row.expectedByNowCents} /> by today. You warn at{' '}
          {row.warnAtPercent}%.
        </span>
      )}
    </Card>
  )
}

/** What rolled over into this period's budget, when rollover moved anything. */
function CarriedNote({ carriedCents }: { carriedCents: number | null }) {
  const { money } = useApp()
  if (!carriedCents) return null
  return (
    <span className="small muted">
      {carriedCents > 0
        ? `Includes ${money(carriedCents)} rolled over from earlier periods.`
        : `Less ${money(-carriedCents)} overspent in earlier periods.`}
    </span>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack-sm" style={{ gap: 2 }}>
      <span className="eyebrow">{label}</span>
      <span className="mid-number num">{value}</span>
    </div>
  )
}
