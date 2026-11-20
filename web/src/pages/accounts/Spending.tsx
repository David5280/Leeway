// Where the money in the accounts shown went this period, biggest category
// first: each a labelled bar against the biggest, the rest added into one
// line. The card opens the math and every category (lib/drills/accountView.ts).

import type { AccountsView } from '../../api/client'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { SectionHead } from '../../components/design/SectionHead'
import { Progress } from '../../components/ui'
import { useApp } from '../../lib/app'
import { spendingDrill } from '../../lib/drills/accountView'
import { periodLabel } from '../../lib/format'

/** Categories listed; the rest are summed into one line. */
export const SPENDING_ROWS = 6

export function Spending({
  spending,
  period,
}: {
  spending: AccountsView['spending']
  period: AccountsView['period']
}) {
  const { money, settings } = useApp()
  const range = (start: string, end: string) => periodLabel(start, end, settings.locale)
  const title = <SectionHead icon="budgets" title="Where did the money go?" />
  if (spending.length === 0) {
    return (
      <Card static="empty" label="Spending by category" className="span-wide stack-sm">
        {title}
        <p className="empty">No spending yet this period.</p>
      </Card>
    )
  }
  const top = spending[0]!.spentCents || 1
  const rest = spending.slice(SPENDING_ROWS).reduce((sum, s) => sum + s.spentCents, 0)
  return (
    <Card
      drill={spendingDrill(spending, period, range)}
      label="Spending by category"
      className="span-wide stack-sm"
    >
      {title}
      <p className="small muted">{range(period.start, period.end)}, biggest first</p>
      {spending.slice(0, SPENDING_ROWS).map((s) => (
        <div key={s.categoryId ?? 'none'} className="stack-sm spend-row">
          <span className="row-between">
            <span className="ellipsis">{s.name}</span>
            <Money cents={s.spentCents} />
          </span>
          <Progress
            percent={(s.spentCents / top) * 100}
            aria-label={`${s.name}: ${money(s.spentCents)}`}
          />
        </div>
      ))}
      {rest > 0 && (
        <span className="small muted row-between">
          <span>Everything else</span>
          <Money cents={rest} />
        </span>
      )}
    </Card>
  )
}
