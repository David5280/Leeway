// The Wealth tab: am I getting ahead? In the order the map gives it: net
// worth and its trend lead, then the accounts grouped by kind (balances are
// what is owned and owed), then four rows to the pages a tap deeper: debts,
// retirement, how much you save and cash that could earn more. Each account's
// page, things entered by hand and Compare accounts open from the accounts.

import { Navigate, useSearchParams } from 'react-router-dom'
import { LinkRows, type LinkRow } from '../components/LinkRows'
import { Shell } from '../components/Shell'
import { IDLE_CASH_TITLE } from '../lib/drills/idleCash'
import { paths } from '../routes'
import { AccountsSection } from './accounts/AccountsSection'
import { NetWorthSection } from './plan/NetWorth'
import { SAVINGS_TITLE } from './Savings'

/** The four pages a tap deeper from Wealth, in the map's order. */
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
    to: paths.savings(),
    label: SAVINGS_TITLE,
    icon: 'growth',
    detail: 'Your savings rate, and money in and out by month',
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
    </Shell>
  )
}
