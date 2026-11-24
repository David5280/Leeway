// The Goals tab: am I on track for what I'm saving for? Every goal, the
// emergency fund and which goal comes first (plan/goals/GoalsSection.tsx).

import { Shell } from '../components/Shell'
import { GoalsSection } from './plan/goals/GoalsSection'

export function Goals() {
  return (
    <Shell>
      <GoalsSection />
    </Shell>
  )
}
