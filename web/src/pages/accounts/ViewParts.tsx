// The parts of an accounts view (summarize_accounts) shared by the Accounts
// screen and one account's page: the summary in words, money in and out,
// spending by category, and the newest transactions.

import type { AccountsView } from '../../api/client'
import { useAction } from '../../api/hooks'
import { Card } from '../../components/design/Card'
import { SectionHead } from '../../components/design/SectionHead'
import { TransactionLine } from '../../components/TransactionLine'
import { recentDrill } from '../../lib/drills/activity'
import { Flows } from './Flows'
import { Spending } from './Spending'

/** The view's summary: a headline and a few points, in plain words. */
export function SummaryCard({ summary }: { summary: AccountsView['summary'] }) {
  return (
    <Card static="words" label="Summary" className="summary stack-sm">
      <p className="eyebrow">Summary</p>
      <p className="summary-headline">{summary.headline}</p>
      {summary.points.length > 0 && (
        <ul className="summary-points">
          {summary.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** The newest transactions on the accounts shown, opening their sum and each one. */
export function RecentCard({ recent }: { recent: AccountsView['recent'] }) {
  const categories = useAction('list_categories')
  // Transfers are left out, so the lines and the sums read them as transfers.
  const byId = new Map(
    (categories.data ?? []).filter((c) => c.kind !== 'transfer').map((c) => [c.id, c]),
  )
  const head = <SectionHead icon="activity" title="Recent activity" />
  if (recent.length === 0) {
    return (
      <Card static="empty" label="Recent transactions" className="stack-sm">
        {head}
        <p className="empty">No transactions yet.</p>
      </Card>
    )
  }
  return (
    <Card drill={recentDrill(recent, byId)} label="Recent transactions" className="stack-sm">
      {head}
      {recent.map((tx) => (
        <TransactionLine
          key={tx.id}
          tx={tx}
          category={tx.categoryId ? byId.get(tx.categoryId) : undefined}
        />
      ))}
    </Card>
  )
}

/** Money in and out beside spending by category. */
export function ViewBreakdowns({ view }: { view: AccountsView }) {
  return (
    <div className="grid">
      <Flows flows={view.flows} />
      <Spending spending={view.spending} period={view.period} />
    </div>
  )
}

/** Money in and out beside spending by category, then the newest transactions. */
export function ViewParts({ view }: { view: AccountsView }) {
  return (
    <>
      <ViewBreakdowns view={view} />
      <RecentCard recent={view.recent} />
    </>
  )
}
