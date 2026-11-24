// One goal's card: how much is saved, what each budget period needs, whether
// recent progress makes the date, and a timeline that shows it. A trip
// budget's goal also links to its trip (TripGoal.tsx).

import { Card } from '../../../components/design/Card'
import type { Goal } from '../../../api/client'
import { GoalTimeline } from '../../../components/charts/GoalTimeline'
import { Progress } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { periodWord } from '../../../lib/format'
import { paceText, planText, thisPeriodText } from '../../../lib/goalText'
import { AddMoney, History } from './Contributions'
import { TripGoal } from './TripGoal'
import { Money } from '../../../components/design/Money'

/** Small labels by the name: what kind of goal, and whether the budget holds money for it. */
function Badges({ goal, word }: { goal: Goal; word: string }) {
  if (goal.kind !== 'purchase' && goal.heldBackCents === 0) return null
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {goal.kind === 'purchase' && <span className="badge">Purchase</span>}
      {goal.heldBackCents > 0 && (
        <span className="badge">
          <Money cents={goal.heldBackCents} /> held from this {word}&apos;s budget
        </span>
      )}
    </div>
  )
}

export function GoalCard({
  goal,
  today,
  onEdit,
}: {
  goal: Goal
  today: string
  onEdit: () => void
}) {
  const { money, settings } = useApp()
  const word = periodWord(settings.period.kind)
  const pace = paceText(goal, settings.locale)
  const thisPeriod = thisPeriodText(goal, money, word)
  return (
    <Card static="pending" label={goal.name} className="span-6 stack-sm">
      <div className="row-between">
        <h2>{goal.name}</h2>
        <button type="button" className="linkbtn" onClick={onEdit}>
          Edit
        </button>
      </div>
      <Badges goal={goal} word={word} />
      <div className="row wrap" style={{ alignItems: 'baseline' }}>
        <Money cents={goal.currentCents} className="mid-number" />
        <span className="muted">
          of <Money cents={goal.targetCents} />
        </span>
      </div>
      <Progress percent={goal.percent} color={goal.color} aria-label={`${goal.name} progress`} />
      <span className="small">{planText(goal, money, word, settings.locale)}</span>
      {thisPeriod && <span className="small muted">{thisPeriod}</span>}
      <GoalTimeline goal={goal} today={today} />
      {pace && <span className={`small ${pace.tone}`}>{pace.text}</span>}
      <TripGoal goal={goal} />
      {goal.accountId ? (
        <span className="small muted">Follows the balance of {goal.accountName}.</span>
      ) : (
        <>
          <AddMoney goal={goal} />
          <History goal={goal} />
        </>
      )}
    </Card>
  )
}
