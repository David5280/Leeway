// Debts and payoff, a tap deeper from Wealth: what the cards cost in interest,
// each card's and loan's terms, and how fast each strategy clears them.

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { DebtsSection } from './plan/Debts'

export function DebtsPage() {
  return (
    <Shell>
      <BackLink to={paths.wealth()} label="Wealth" />
      <h1>Debts</h1>
      <DebtsSection />
    </Shell>
  )
}
