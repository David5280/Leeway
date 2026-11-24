// Retirement, a tap deeper from Wealth: the projection, pensions, paystub
// import and the assumptions behind them (plan/retirement/RetirementSection.tsx).

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { RetirementSection } from './plan/retirement/RetirementSection'

export function RetirementPage() {
  return (
    <Shell>
      <BackLink to={paths.wealth()} label="Wealth" />
      <h1>Retirement</h1>
      <RetirementSection />
    </Shell>
  )
}
