// The picked accounts' balances as a row of figures: what can be spent, what
// the bank posted, what is owed and how much credit is left.

import type { ReactNode } from 'react'
import type { AccountsView } from '../../api/client'
import { useApp } from '../../lib/app'
import { timeAgo } from '../../lib/format'

function Figure({
  title,
  value,
  note,
  alarm = false,
}: {
  title: string
  value: string
  note: ReactNode
  /** Red, for money below zero. */
  alarm?: boolean
}) {
  return (
    <div className="card stack-sm">
      <p className="eyebrow">{title}</p>
      <span className={alarm ? 'num mid-number over' : 'num mid-number'}>{value}</span>
      <span className="small muted">{note}</span>
    </div>
  )
}

/** Only the figures that apply: a card alone has no cash, an account alone no net. */
export function Balances({ view }: { view: AccountsView }) {
  const { exact } = useApp()
  const { balances: b, accounts } = view
  const kinds = [b.cashAccounts, b.debtAccounts, b.otherAccounts].filter((n) => n > 0).length
  return (
    <section aria-label="Balances" className="stack-sm">
      <div className="glance balance-figures">
        {b.cashAccounts > 0 && (
          <>
            <Figure
              title="Available"
              value={exact(b.availableCents)}
              note="Can be spent now, after pending charges"
              alarm={b.availableCents < 0}
            />
            <Figure
              title="Current balance"
              value={exact(b.cashCents)}
              note="As the bank last posted it"
              alarm={b.cashCents < 0}
            />
          </>
        )}
        {b.debtAccounts > 0 && (
          <Figure title="Owed" value={exact(b.owedCents)} note="On cards and loans" />
        )}
        {b.creditLimitCents !== null && (
          <Figure
            title="Credit left"
            value={exact(b.creditLeftCents!)}
            note={`Of a ${exact(b.creditLimitCents)} limit`}
            alarm={b.creditLeftCents! < 0}
          />
        )}
        {b.otherAccounts > 0 && (
          <Figure title="Other" value={exact(b.otherCents)} note="Investments, property and more" />
        )}
        {kinds > 1 && <Figure title="Net" value={exact(b.netCents)} note="Owned, less owed" />}
      </div>
      <p className="small muted">{updatedNote(accounts)}</p>
    </section>
  )
}

/** When the balances were read: one account's own time, or the oldest of several. */
export function updatedNote(accounts: AccountsView['accounts'], now?: number): string {
  // ISO timestamps sort as text, so the first is the oldest.
  const times = accounts
    .map((account) => account.balanceUpdatedAt)
    .filter((at): at is string => at !== null)
    .sort()
  if (times.length === 0) return 'No balance has been read yet.'
  const when = timeAgo(times[0]!, now)
  return accounts.length === 1
    ? `Balance updated ${when}.`
    : `Balances updated ${when} at the oldest.`
}
