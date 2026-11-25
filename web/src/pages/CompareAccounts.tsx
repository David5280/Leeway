// Compare accounts, a tap deeper from Home's accounts: tick a few to see
// what they come to together, and their money in and out, spending and recent
// activity (accounts/ComparePicker.tsx).

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { ComparePicker } from './accounts/ComparePicker'

export function CompareAccountsPage() {
  return (
    <Shell>
      <BackLink to={paths.home()} label="Home" />
      <h1>Compare accounts</h1>
      <ComparePicker />
    </Shell>
  )
}
