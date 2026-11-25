// Flexible spending so far against an even pace, with where it is heading.
// The chart is drawn as it always has been, with its readout under a finger;
// the title and sentence above it open the math behind where spending lands
// (lib/drills/pace.ts). Home shows it for now; Spending for whichever period
// its arrows are on.

import { Card } from '../components/design/Card'
import type { Budget, SpendingPace } from '../api/client'
import { useAction } from '../api/hooks'
import { PaceChart } from '../components/charts/PaceChart'
import { Money } from '../components/design/Money'
import { SectionHead } from '../components/design/SectionHead'
import { paceDrill } from '../lib/drills/pace'
import { ErrorNote, Loading } from '../components/ui'
import type { WidgetProps } from './types'

/** Home's card: always the current period. */
export function PaceWidget({ budget }: WidgetProps) {
  return <PaceCard budget={budget} offset={0} />
}

/** The pace of the period `offset` periods back (0 is now), with that period's budget. */
export function PaceCard({ budget, offset }: { budget: Budget; offset: number }) {
  const pace = useAction('get_spending_pace', { offset })
  const names = budget.categories
    .filter((c) => pace.data?.categoryIds.includes(c.categoryId))
    .map((c) => c.name)
  const head = (
    <div className="stack-sm" style={{ gap: 2 }}>
      <SectionHead icon="pace" title="Flexible spending pace" />
      {names.length > 0 && (
        <span className="small muted" title={names.join(', ')}>
          {followedText(names)}
        </span>
      )}
    </div>
  )
  // Only a pace with categories to follow has a figure to explain.
  if (!pace.data || pace.data.categoryIds.length === 0) {
    return (
      <Card static="empty" label="Spending pace" className="stack-sm">
        {head}
        {pace.error ? <ErrorNote error={pace.error} /> : <PaceBody pace={pace.data} />}
      </Card>
    )
  }
  return (
    <Card
      drill={paceDrill(pace.data, budget, offset === 0)}
      below={<PaceChart pace={pace.data} isCurrent={offset === 0} />}
      label="Spending pace"
      className="stack-sm"
    >
      {head}
      <PaceSummary pace={pace.data} isCurrent={offset === 0} />
    </Card>
  )
}

/** The categories the pace follows: all of a few, or the first two and a count of the rest. */
export function followedText(names: string[]): string {
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/** Before there is a pace to explain: still loading, or no category with pace on. */
function PaceBody({ pace }: { pace: SpendingPace | undefined }) {
  if (!pace) return <Loading />
  return (
    <p className="muted">
      Give a category a budget with pace on to see whether you're spending steadily.
    </p>
  )
}

/** One sentence: where spending lands (projected now, actual for a past period) against budget. */
function PaceSummary({ pace, isCurrent }: { pace: SpendingPace; isCurrent: boolean }) {
  const landing = isCurrent ? pace.projectedCents : (pace.cumulative.at(-1)?.cents ?? 0)
  const gap = landing - pace.budgetCents
  return (
    <p style={{ fontSize: 14 }}>
      {isCurrent ? 'At this rate you land near ' : 'You spent '}
      <strong>
        <Money cents={landing} />
      </strong>
      {gap > 0 ? (
        <>
          , about{' '}
          <span className="over strong">
            <Money cents={gap} /> over
          </span>{' '}
          the <Money cents={pace.budgetCents} /> budget.
        </>
      ) : (
        <>
          ,{' '}
          <span className="good strong">
            <Money cents={-gap} /> under
          </span>{' '}
          the <Money cents={pace.budgetCents} /> budget.
        </>
      )}
    </p>
  )
}
