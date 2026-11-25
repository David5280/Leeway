// The Wealth tab: am I getting ahead? In the order the map gives it: net
// worth and its trend lead, then the rows to the pages a tap deeper: things
// entered by hand, debts, retirement, how much you save and cash that could
// earn more. Every account, with its own page and Compare accounts, is on
// Home, the first place the owner looks.

import { Navigate } from 'react-router-dom'
import { LinkRows, type LinkRow } from '../components/LinkRows'
import { Shell } from '../components/Shell'
import { IDLE_CASH_TITLE } from '../lib/drills/idleCash'
import { paths } from '../routes'
import { useSelectedAccount } from './OldAddresses'
import { NetWorthSection } from './plan/NetWorth'
import { SAVINGS_TITLE } from './Savings'

/** The pages a tap deeper from Wealth, in the map's order. */
const DEEPER: LinkRow[] = [
  {
    to: paths.owned(),
    label: 'Things you own and owe',
    icon: 'wallet',
    detail: "A home, a car or a loan your bank doesn't show",
  },
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
  const selected = useSelectedAccount()
  if (selected) return <Navigate to={selected} replace />
  return (
    <Shell>
      <h1>Wealth</h1>
      <NetWorthSection />
      <LinkRows label="More on wealth" rows={DEEPER} />
    </Shell>
  )
}
