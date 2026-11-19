// The picked accounts' balances as a row of figures: what can be spent, what
// the bank posted, what is owed and how much credit is left.

import type { ReactNode } from 'react'
import type { AccountsView } from '../../api/client'
import { Money } from '../../components/design/Money'
import { timeAgo } from '../../lib/format'

/** One balance, to the cent, over a note on what it is. */
function Figure({
  title,
  cents,
  note,
  alarm = false,
}: {
  title: string
  cents: number
  note: ReactNode
  /** The problem tone, for money below zero. */
  alarm?: boolean
}) {
  return (
    <div className="card stack-sm">
      <p className="eyebrow">{title}</p>
      <Money
        cents={cents}
        precision="cents"
        tone={alarm ? 'problem' : undefined}
        className="mid-number"
      />
      <span className="small muted">{note}</span>
    </div>
  )
}

/** Only the figures that apply: a card alone has no cash, an account alone no net. */
export function Balances({ view }: { view: AccountsView }) {
  const { balances: b, accounts } = view
  const kinds = [b.cashAccounts, b.debtAccounts, b.otherAccounts].filter((n) => n > 0).length
  return (
    <section aria-label="Balances" className="stack-sm">
      <div className="glance balance-figures">
        {b.cashAccounts > 0 && (
          <>
            <Figure
              title="Available"
              cents={b.availableCents}
              note="Can be spent now, after pending charges"
              alarm={b.availableCents < 0}
            />
            <Figure
              title="Current balance"
              cents={b.cashCents}
              note="As the bank last posted it"
              alarm={b.cashCents < 0}
            />
          </>
        )}
        {b.debtAccounts > 0 && (
          <Figure title="Owed" cents={b.owedCents} note="On cards and loans" />
        )}
        {b.creditLimitCents !== null && (
          <Figure
            title="Credit left"
            cents={b.creditLeftCents!}
            note={
              <>
                Of a <Money cents={b.creditLimitCents} precision="cents" /> limit
              </>
            }
            alarm={b.creditLeftCents! < 0}
          />
        )}
        {b.otherAccounts > 0 && (
          <Figure title="Other" cents={b.otherCents} note="Investments, property and more" />
        )}
        {kinds > 1 && <Figure title="Net" cents={b.netCents} note="Owned, less owed" />}
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
