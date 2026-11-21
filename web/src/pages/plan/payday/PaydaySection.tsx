// The Plan's Payday section, most general first: any checking account that
// may run short before payday, as the one thing that needs doing; what was
// left from the last paycheck and the plan for the new one; then what pay
// brings in, the yearly costs saved toward from it, and, when nothing runs
// short, the all-clear for checking.

import { OverdraftCard } from './OverdraftCard'
import { PayCard } from './PayCard'
import { Playbook } from './Playbook'
import { SinkingFunds } from './SinkingFunds'

export function PaydaySection() {
  return (
    <>
      <OverdraftCard place="short" />
      <Playbook />
      <PayCard />
      <SinkingFunds />
      <OverdraftCard place="lasts" />
    </>
  )
}
