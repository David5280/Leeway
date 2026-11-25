// Home's Latest activity card: the newest few transactions, each with its
// merchant, category and amount, and the whole card opens Spending's
// Activity, where each one is opened and changed. Money in reads green, and
// a move between the owner's own accounts says Transfer, since it is neither
// spending nor income (components/TransactionLine.tsx).

import { useAction } from '../api/hooks'
import { Card } from '../components/design/Card'
import { SectionHead } from '../components/design/SectionHead'
import { TransactionLine } from '../components/TransactionLine'
import { LoadingOrError } from '../components/ui'
import { paths } from '../routes'
import type { WidgetProps } from './types'

const NAME = 'Latest activity'

/** Transactions shown: enough to see what moved, few enough to stay calm. */
export const LATEST_COUNT = 4

export function LatestActivityWidget({ budget }: WidgetProps) {
  const latest = useAction('list_transactions', { limit: LATEST_COUNT })
  // The budget lists every category but transfers, which each line then reads as a transfer.
  const categories = new Map(budget.categories.map((c) => [c.categoryId, c]))
  const head = <SectionHead icon="activity" title={NAME} />
  if (!latest.data || latest.data.transactions.length === 0) {
    return (
      <Card static="empty" label={NAME} className="stack-sm">
        {head}
        {latest.data ? (
          <p className="empty">No transactions yet.</p>
        ) : (
          <LoadingOrError error={latest.error} />
        )}
      </Card>
    )
  }
  return (
    <Card to={paths.activity()} label={NAME} className="stack-sm">
      {head}
      {latest.data.transactions.map((tx) => (
        <TransactionLine
          key={tx.id}
          tx={tx}
          category={tx.categoryId ? categories.get(tx.categoryId) : undefined}
        />
      ))}
    </Card>
  )
}
