// Flexible spending so far against an even pace, with where it is heading.

import type { CSSProperties } from 'react'
import type { SpendingPace } from '../api/client'
import { useAction } from '../api/hooks'
import { PaceChart } from '../components/charts'
import { Card, ErrorNote, Loading } from '../components/ui'
import { useApp } from '../lib/app'
import type { WidgetProps } from './types'

export function PaceWidget({ budget, offset }: WidgetProps) {
  const pace = useAction('get_spending_pace', { offset })
  const names = budget.categories
    .filter((c) => pace.data?.categoryIds.includes(c.categoryId))
    .map((c) => c.name)
  return (
    <Card label="Spending pace" className="stack">
      <div className="row-between" style={{ alignItems: 'baseline' }}>
        <h2>Flexible spending pace</h2>
        {names.length > 0 && <span className="small muted">{names.join(', ')}</span>}
      </div>
      {pace.error ? (
        <ErrorNote error={pace.error} />
      ) : (
        <PaceBody pace={pace.data} isCurrent={offset === 0} />
      )}
    </Card>
  )
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
      <PaceChart pace={pace} />
      <PaceLegend isCurrent={isCurrent} />
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
      <strong className="num">{money(landing)}</strong>
      {gap > 0 ? (
        <>
          , about <span className="num over strong">{money(gap)} over</span> the {budget} budget.
        </>
      ) : (
        <>
          , <span className="num good">{money(-gap)} under</span> the {budget} budget.
        </>
      )}
    </p>
  )
}

function LegendItem({ line, label }: { line: CSSProperties; label: string }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span aria-hidden="true" style={{ width: 16, ...line }} />
      {label}
    </span>
  )
}

function PaceLegend({ isCurrent }: { isCurrent: boolean }) {
  return (
    <div className="row wrap small muted" style={{ gap: 16 }}>
      <LegendItem line={{ height: 2, background: 'var(--accent)' }} label="Actual" />
      <LegendItem line={{ borderTop: '2px dashed var(--muted)' }} label="Even pace" />
      {/* A past period is finished, so there is nothing to project. */}
      {isCurrent && (
        <LegendItem line={{ borderTop: '2px dotted var(--accent)' }} label="Projected" />
      )}
    </div>
  )
}
