// The latest few transactions of the period on screen, newest first, and the
// way on to all activity, where they can be searched, filtered, added by hand,
// imported from a file and sorted several at once.

import { Link } from 'react-router-dom'
import type { Budget } from '../../api/client'
import { useAction } from '../../api/hooks'
import { Card } from '../../components/design/Card'
import { SectionHead } from '../../components/design/SectionHead'
import { TransactionLine } from '../../components/TransactionLine'
import { Icon, LoadingOrError } from '../../components/ui'
import { paths } from '../../routes'

/** How many transactions the card lists: a glance, not the list. */
export const LATEST = 4

export function LatestTransactions({ budget }: { budget: Budget }) {
  return (
    <Card static="list" label="Latest transactions" className="stack-sm">
      <SectionHead icon="activity" title="Latest transactions" />
      <Rows budget={budget} />
      <Link to={paths.activity()} className="list-row clickrow link-row">
        <span className="grow link-row-label">All activity</span>
        <Icon name="forward" size={18} />
      </Link>
    </Card>
  )
}

/** The period's latest transactions, or why there are none to show yet. */
function Rows({ budget }: { budget: Budget }) {
  const { start, end } = budget.period
  const latest = useAction('list_transactions', { limit: LATEST, start, end })
  if (!latest.data) {
    return <LoadingOrError error={latest.error} label="Loading the latest transactions" />
  }
  if (latest.data.transactions.length === 0) {
    return <p className="empty">No transactions in this period yet.</p>
  }
  // The budget lists every category but transfers, which the line reads as transfers.
  const categories = new Map(budget.categories.map((row) => [row.categoryId, row]))
  return latest.data.transactions.map((tx) => (
    <TransactionLine
      key={tx.id}
      tx={tx}
      category={tx.categoryId ? categories.get(tx.categoryId) : undefined}
    />
  ))
}
