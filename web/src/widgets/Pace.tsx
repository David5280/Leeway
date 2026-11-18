// Flexible spending so far against an even pace, with where it is heading.

import type { SpendingPace } from '../api/client'
import { useAction } from '../api/hooks'
import { PaceChart } from '../components/charts/PaceChart'
import { Card, ErrorNote, Loading } from '../components/ui'
import { useApp } from '../lib/app'
import type { WidgetProps } from './types'

export function PaceWidget({ budget, offset }: WidgetProps) {
  const pace = useAction('get_spending_pace', { offset })
  const names = budget.categories
    .filter((c) => pace.data?.categoryIds.includes(c.categoryId))
    .map((c) => c.name)
  return (
    <Card label="Spending pace" className="stack-sm">
      <div className="stack-sm" style={{ gap: 2 }}>
        <h2>Flexible spending pace</h2>
        {names.length > 0 && (
          <span className="small muted" title={names.join(', ')}>
            {followedText(names)}
          </span>
        )}
      </div>
      {pace.error ? (
        <ErrorNote error={pace.error} />
      ) : (
        <PaceBody pace={pace.data} isCurrent={offset === 0} />
      )}
    </Card>
  )
}

/** The categories the pace follows: all of a few, or the first two and a count of the rest. */
export function followedText(names: string[]): string {
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

function PaceBody({ pace, isCurrent }: { pace: SpendingPace | undefined; isCurrent: boolean }) {
  if (!pace) return <Loading />
  if (pace.categoryIds.length === 0) {
    return (
      <p className="muted">
        Give a category a budget with pace on to see whether you're spending steadily.
      </p>
    )
  }
  return (
    <>
      <PaceSummary pace={pace} isCurrent={isCurrent} />
      <PaceChart pace={pace} isCurrent={isCurrent} />
    </>
  )
}

/** One sentence: where spending lands (projected now, actual for a past period) against budget. */
function PaceSummary({ pace, isCurrent }: { pace: SpendingPace; isCurrent: boolean }) {
  const { money } = useApp()
  const landing = isCurrent ? pace.projectedCents : (pace.cumulative.at(-1)?.cents ?? 0)
  const gap = landing - pace.budgetCents
  const budget = money(pace.budgetCents)
  return (
    <p style={{ fontSize: 14 }}>
      {isCurrent ? 'At this rate you land near ' : 'You spent '}
      <strong>{money(landing)}</strong>
      {gap > 0 ? (
        <>
          , about <span className="over strong">{money(gap)} over</span> the {budget} budget.
        </>
      ) : (
        <>
          , <span className="good strong">{money(-gap)} under</span> the {budget} budget.
        </>
      )}
    </p>
  )
}
