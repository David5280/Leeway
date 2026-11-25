// Spending over time, a tap deeper from Spending's Trends row: each of the
// last twelve budget periods as a bar against today's budgets, and as a row
// that opens Spending on that period (spending/trends/OverTime.tsx). The way
// back returns to the period Spending was on (?period=).

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { useSpendingPeriod } from './spending/period'
import { OverTime } from './spending/trends/OverTime'

export function SpendingOverTimePage() {
  const [period] = useSpendingPeriod()
  return (
    <Shell>
      <BackLink to={paths.spending(period)} label="Spending" />
      <h1>Spending over time</h1>
      <OverTime />
    </Shell>
  )
}
