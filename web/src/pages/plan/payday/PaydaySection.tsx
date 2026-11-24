// The payday section, first on the Payday tab, general to detailed: the
// payday playbook (what was left of the last paycheck and what the new one
// covers), then what pay brings in and when it lands, then the yearly costs
// saved toward from it.

import { PayCard } from './PayCard'
import { Playbook } from './Playbook'
import { SinkingFunds } from './SinkingFunds'

export function PaydaySection() {
  return (
    <>
      <Playbook />
      <PayCard />
      <SinkingFunds />
    </>
  )
}
