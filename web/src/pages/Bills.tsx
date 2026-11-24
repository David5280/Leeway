// Bills and subscriptions, a tap deeper from Payday: what is due and when,
// and repeating charges found in history (plan/Bills.tsx). "?bill=<id>" opens
// straight onto that bill's form (paths.bills).

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { BillsSection } from './plan/Bills'

export function BillsPage() {
  return (
    <Shell>
      <BackLink to={paths.payday()} label="Payday" />
      <h1>Bills</h1>
      <BillsSection />
    </Shell>
  )
}
