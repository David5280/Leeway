// The Plan's Payday section: any checking account that may run short before
// payday first, as the one thing that needs doing, then what pay brings in,
// then, when nothing runs short, the all-clear for checking.

import { OverdraftCard } from './OverdraftCard'
import { PayCard } from './PayCard'

export function PaydaySection() {
  return (
    <>
      <OverdraftCard place="short" />
      <PayCard />
      <OverdraftCard place="lasts" />
    </>
  )
}
