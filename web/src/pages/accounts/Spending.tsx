// Where the picked accounts' money went this period, by category.

import { Card } from '../../components/design/Card'
import type { AccountsView } from '../../api/client'
import { Dot, Progress } from '../../components/ui'
import { useApp } from '../../lib/app'
import { periodLabel } from '../../lib/format'
import { Money } from '../../components/design/Money'

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
  const top = spending[0]?.spentCents ?? 1
  const shown = spending.slice(0, SPENDING_ROWS)
  const rest = spending.slice(SPENDING_ROWS).reduce((sum, s) => sum + s.spentCents, 0)
  return (
    <Card static="pending" label="Spending by category" className="span-wide stack-sm">
      <div className="stack-sm" style={{ gap: 2 }}>
        <h2>Spending by category</h2>
        <p className="small muted">{periodLabel(period.start, period.end, settings.locale)}</p>
      </div>
      {spending.length === 0 && <p className="empty">No spending yet this period.</p>}
      {shown.map((s) => (
        <div key={s.categoryId ?? 'none'} className="stack-sm" style={{ padding: '6px 0' }}>
          <div className="row-between">
            <span className="row" style={{ gap: 8 }}>
              <Dot color={s.color} dashed={s.categoryId === null} />
              {s.name}
            </span>
            <Money cents={s.spentCents} />
          </div>
          <Progress
            percent={(s.spentCents / top) * 100}
            color={s.color ?? 'var(--muted)'}
            aria-label={`${s.name}: ${money(s.spentCents)}`}
          />
        </div>
      ))}
      {rest > 0 && (
        <p className="small muted row-between">
          <span>Everything else</span>
          <Money cents={rest} />
        </p>
      )}
    </Card>
  )
}
