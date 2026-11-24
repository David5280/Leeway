// Cash that could earn more, a tap deeper from Wealth: checking money not
// needed before payday, and what it might earn in savings (plan/IdleCash.tsx).
// The card says nothing when no cash is spare, so the page says why in words.

import type { Output } from '../api/client'
import { useAction } from '../api/hooks'
import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { LoadingOrError } from '../components/ui'
import { IDLE_CASH_TITLE } from '../lib/drills/idleCash'
import { paths } from '../routes'
import { IdleCashCard } from './plan/IdleCash'

type Reason = NonNullable<Output<'get_idle_cash'>['reason']>

/** Why no move to savings is suggested, by the server's reason. */
export const NOT_SUGGESTED: Record<Reason, string> = {
  overdrawn: 'An account is overdrawn, so no cash should move to savings right now.',
  tight: 'Cash is tight before payday, so checking needs what it holds.',
  no_balance: "Checking's balance isn't known yet, so there's nothing to suggest.",
  no_payday: "Payday isn't known yet, so Leeway can't tell what checking needs until then.",
  no_spending_history:
    "There isn't enough spending history yet to tell what checking needs until payday.",
  not_enough_extra: 'Checking holds about what it needs until payday, with little to spare.',
}

export function IdleCashPage() {
  // The same query the card reads, so the server is asked only once.
  const idle = useAction('get_idle_cash')
  return (
    <Shell>
      <BackLink to={paths.wealth()} label="Wealth" />
      <h1>{IDLE_CASH_TITLE}</h1>
      {!idle.data && <LoadingOrError error={idle.error} />}
      {idle.data?.reason && <p className="empty">{NOT_SUGGESTED[idle.data.reason]}</p>}
      <IdleCashCard />
    </Shell>
  )
}
