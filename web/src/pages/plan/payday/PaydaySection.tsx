// The payday section, first on the Payday tab, general to detailed: the
// payday playbook (what was left of the last paycheck and what the new one
// covers), then what pay brings in and when it lands. Yearly costs live on
// Goals; Payday only totals what is set aside, linking there.

import { PayCard } from './PayCard'
import { Playbook } from './Playbook'

export function PaydaySection() {
  return (
    <>
      <Playbook />
      <PayCard />
    </>
  )
}
