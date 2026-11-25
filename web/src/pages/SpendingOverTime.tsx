// Spending over time, a tap deeper from Spending's Trends row: each of the
// last twelve budget periods as a bar against today's budgets, and as a row
// that opens Spending on that period (spending/trends/OverTime.tsx).

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { OverTime } from './spending/trends/OverTime'

export function SpendingOverTimePage() {
  return (
    <Shell>
      <BackLink to={paths.spending()} label="Spending" />
      <h1>Spending over time</h1>
      <OverTime />
    </Shell>
  )
}
