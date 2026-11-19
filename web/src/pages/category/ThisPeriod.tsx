// A category's numbers for the current period: spent, budget, left and pace.

import type { ReactNode } from 'react'
import type { Budget, Category, CategoryBudget } from '../../api/client'
import { Money } from '../../components/design/Money'
import { Card, Progress } from '../../components/ui'

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
  const perDay = perDayLeft(row.leftCents, period.daysLeft)
  const isExpense = row.kind === 'expense'
  // The marker on the bar shows how far through the period today is.
  const todayMarker = row.pace !== null ? (period.daysElapsed / period.days) * 100 : null
  return (
    <Card label="This period" className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <Stat label={row.kind === 'income' ? 'Received' : 'Spent'}>
          <Money cents={row.spentCents} />
        </Stat>
        <Stat label="Budget">
          {row.budgetCents === null ? 'None' : <Money cents={row.budgetCents} />}
        </Stat>
        <Stat label="Left">
          {row.leftCents !== null && (
            // Below zero is over budget, which reads as a problem.
            <Money cents={row.leftCents} tone={row.leftCents < 0 ? 'problem' : undefined} />
          )}
        </Stat>
        {isExpense && perDay !== null && (
          <Stat label="Per day left">
            <Money cents={perDay} />
          </Stat>
        )}
      </div>
      {row.budgetCents !== null && isExpense && (
        <Progress
          thick
          aria-label={`${row.name} budget used`}
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
  if (!carriedCents) return null
  return (
    <span className="small muted">
      {carriedCents > 0 ? (
        <>
          Includes <Money cents={carriedCents} /> rolled over from earlier periods.
        </>
      ) : (
        <>
          Less <Money cents={-carriedCents} /> overspent in earlier periods.
        </>
      )}
    </span>
  )
}

/** One of the period's figures under its name. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stack-sm" style={{ gap: 2 }}>
      <span className="eyebrow">{label}</span>
      <span className="mid-number">{children}</span>
    </div>
  )
}
