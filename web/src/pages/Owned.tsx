// Things you own and owe, a tap deeper from Wealth: the home, car
// and loans the owner enters by hand, which count in net worth beside the
// bank's balances (plan/owned/OwnedCard.tsx).

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { OwnedCard } from './plan/owned/OwnedCard'

export function OwnedPage() {
  return (
    <Shell>
      <BackLink to={paths.wealth()} label="Wealth" />
      <h1>Things you own and owe</h1>
      <OwnedCard />
    </Shell>
  )
}
