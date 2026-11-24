// The Goals tab: am I on track? In the order the map gives it: what is set
// aside each paycheck and the goal next to land (the lead), then "Can I
// afford it?", the emergency fund, every goal in the order it is funded, and
// the yearly costs saved toward. A "Save for it" from the afford check opens
// a purchase goal filled in from what was typed.

import { Shell } from '../components/Shell'
import { AffordCheck } from './plan/goals/afford/AffordCheck'
import { useGoalEditing } from './plan/goals/GoalEditor'
import { GoalsSection } from './plan/goals/GoalsSection'
import { GoalsLead } from './plan/goals/lead/GoalsLead'
import { YearlyCosts } from './plan/goals/yearly/YearlyCosts'

export function Goals() {
  const { editing, open, close } = useGoalEditing()
  return (
    <Shell>
      <h1>Goals</h1>
      <GoalsLead />
      <AffordCheck onSaveFor={(draft) => open({ goal: null, kind: 'purchase', draft })} />
      <GoalsSection editing={editing} onOpen={open} onClose={close} />
      <YearlyCosts />
    </Shell>
  )
}
