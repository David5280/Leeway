// How much you save, a tap deeper from Wealth: the share of pay a usual month
// saves (plan/SavingsRate.tsx), then money in and out by month, the monthly
// picture of what is kept (widgets/Flows.tsx).

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { FlowsWidget } from '../widgets/Flows'
import { SavingsRateCard } from './plan/SavingsRate'

/** The page's name, also its row on Wealth. */
export const SAVINGS_TITLE = 'How much you save'

export function SavingsPage() {
  return (
    <Shell>
      <BackLink to={paths.wealth()} label="Wealth" />
      <h1>{SAVINGS_TITLE}</h1>
      <SavingsRateCard />
      <FlowsWidget />
    </Shell>
  )
}
