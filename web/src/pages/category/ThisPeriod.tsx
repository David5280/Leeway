// A category's numbers for the current period: what went out (or came in)
// against its budget and the last period, how much of the budget is used,
// and what can still go each day.

import type { ReactNode } from 'react'
import type { Budget, CategoryBudget } from '../../api/client'
import { KeyFigure } from '../../components/design/KeyFigure'
import { Money } from '../../components/design/Money'
import { ProgressRing } from '../../components/design/ProgressRing'
import { Trend, trendPercent } from '../../components/design/Trend'
import { Card } from '../../components/ui'
import { useApp } from '../../lib/app'
import { budgetTone } from '../../lib/budgetText'
import { periodWord } from '../../lib/format'

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
  row,
  period,
  previousCents,
}: {
  row: CategoryBudget
  period: Period
  /** The same number of days into the last period, read as `row.spentCents` is. */
  previousCents: number
}) {
  const { settings } = useApp()
  const word = periodWord(settings.period.kind)
  const perDay = perDayLeft(row.leftCents, period.daysLeft)
  const isExpense = row.kind === 'expense'
  const isIncome = row.kind === 'income'
  // A caption only when there is a budget to measure against or a last period to compare.
  const hasCaption = row.leftCents !== null || trendPercent(row.spentCents, previousCents) !== null
  // The tick on the ring shows how far through the period today is.
  const todayMarker = row.pace !== null ? (period.daysElapsed / period.days) * 100 : null
  return (
    <Card label="This period" className="stack">
      <div className="row-between">
        <KeyFigure
          label={`${isIncome ? 'Received' : 'Spent'} this ${word}`}
          cents={row.spentCents}
          caption={
            hasCaption && (
              <>
                <LeftOfBudget row={row} />{' '}
                <Trend
                  current={row.spentCents}
                  previous={previousCents}
                  goodWhen={isIncome ? 'up' : 'down'}
                  label={`${isIncome ? 'Income' : 'Spending'} compared with this point last ${word}`}
                />
              </>
            )
          }
        />
        {row.budgetCents !== null && isExpense && (
          <ProgressRing
            size={64}
            label={`${row.name} budget used`}
            percent={row.percentUsed ?? 0}
            status={budgetTone(row.status)}
            marker={todayMarker}
          />
        )}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <Stat label="Budget">
          {row.budgetCents === null ? 'None' : <Money cents={row.budgetCents} />}
        </Stat>
        {isExpense && perDay !== null && (
          <Stat label="Per day left">
            <Money cents={perDay} />
          </Stat>
        )}
      </div>
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

/**
 * Where the amount stands against the budget, in a few words: "$360 left" or
 * "$30 over" for spending, "$2,500 still to come" for income. Nothing
 * without a budget.
 */
function LeftOfBudget({ row }: { row: CategoryBudget }) {
  if (row.leftCents === null) return null
  const left = row.leftCents
  if (row.kind === 'income') {
    if (left > 0)
      return (
        <>
          <b>
            <Money cents={left} />
          </b>{' '}
          still to come
        </>
      )
    if (left < 0)
      return (
        <>
          <b>
            <Money cents={-left} />
          </b>{' '}
          more than expected
        </>
      )
    return <>All of it in</>
  }
  if (left < 0) {
    // Past the budget reads as a problem, in the words and in the tone.
    return (
      <b>
        <Money cents={-left} tone="problem" /> over
      </b>
    )
  }
  return (
    <>
      <b>
        <Money cents={left} />
      </b>{' '}
      left
    </>
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
