// The Wealth tab: am I getting ahead? Net worth and its trend lead, then the
// accounts grouped by kind, then rows to the pages a tap deeper (debts,
// retirement, cash that could earn more), then the activity on the accounts.

import { Navigate, useSearchParams } from 'react-router-dom'
import { LinkRows, type LinkRow } from '../components/LinkRows'
import { Shell } from '../components/Shell'
import { IDLE_CASH_TITLE } from '../lib/drills/idleCash'
import { paths } from '../routes'
import { AccountsActivity, AccountsSection } from './accounts/AccountsSection'
import { NetWorthSection } from './plan/NetWorth'

/** The pages a tap deeper from Wealth. */
const DEEPER: LinkRow[] = [
  {
    to: paths.debts(),
    label: 'Debts and payoff',
    icon: 'loan',
    detail: 'What cards and loans cost, and how fast to clear them',
  },
  {
    to: paths.retirement(),
    label: 'Retirement',
    icon: 'sunrise',
    detail: 'What your savings and pensions could pay',
  },
  {
    to: paths.idleCash(),
    label: IDLE_CASH_TITLE,
    icon: 'piggy',
    detail: "Checking money you won't need before payday",
  },
]

export function Wealth() {
  // Old links picked one account here (?select=id); that account has its own page now.
  const [params] = useSearchParams()
  const linked = params.get('select')
  if (linked) return <Navigate to={paths.account(linked)} replace />
  return (
    <Shell>
      <h1>Wealth</h1>
      <NetWorthSection />
      <AccountsSection />
      <LinkRows label="More on wealth" rows={DEEPER} />
      <AccountsActivity />
    </Shell>
  )
}
