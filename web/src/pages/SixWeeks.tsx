// The six weeks ahead, a tap deeper from Payday: paydays, bills due and, with
// a calendar linked, the events likely to cost money, week by week, then
// recent and coming trips (plan/Ahead.tsx).

import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { AheadSection } from './plan/Ahead'

export function SixWeeksPage() {
  return (
    <Shell>
      <BackLink to={paths.payday()} label="Payday" />
      <h1>Six weeks ahead</h1>
      <AheadSection />
    </Shell>
  )
}
