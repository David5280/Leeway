// Your pay, a tap deeper from Payday: the paycheck Leeway found (or the one
// entered), with a tap to confirm or change it, then what the newest paystub
// shows. Importing or redoing a paystub stays in Settings, linked from here.

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { PayCard } from './plan/payday/PayCard'
import { PaystubCard } from './plan/payday/PaystubCard'

export function YourPayPage() {
  return (
    <Shell>
      <BackLink to={paths.payday()} label="Payday" />
      <h1>Your pay</h1>
      <PayCard />
      <PaystubCard />
    </Shell>
  )
}
