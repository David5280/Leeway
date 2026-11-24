// The Plan's Payday section: what pay brings in and when it lands, then the
// yearly costs saved toward from it.

import { PayCard } from './PayCard'
import { SinkingFunds } from './SinkingFunds'

export function PaydaySection() {
  return (
    <>
      <PayCard />
      <SinkingFunds />
    </>
  )
}
