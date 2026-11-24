// The emergency fund and the owner's goals, after Goals' lead and afford
// check: any open goal form first, then the emergency fund (its card, the
// offer to start one, or a line on when it can be sized), then every other
// goal in the order they are funded, with which comes first when two or more
// compete. When the fund alone fails to load, the goals still show, with a
// way to try the fund again.

import type { Goal } from '../../../api/client'
import { useAction } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { LoadingOrError } from '../../../components/ui'
import type { EmergencyView } from '../../../lib/emergencyText'
import { EmergencyCard, EmergencyOffer } from './EmergencyFund'
import { GoalCard } from './GoalCard'
import { GoalEditor, type Editing } from './GoalEditor'
import { GoalOrderCard } from './GoalOrder'

/** Said while there is too little spending to size an emergency fund from. */
export const NO_FUND_YET =
  'Your emergency fund shows here once Leeway has a month of your spending to size it from.'

/** Goals still being saved for compete for the same money; two or more make an order worth setting. */
const competing = (goals: Goal[]) =>
  goals.filter((goal) => goal.status === 'in_progress' || goal.status === 'past_due').length >= 2

/** In place of the fund's card or offer when it could not load: a line and a retry. */
function FundTrouble({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <p className="small muted">
      The emergency fund did not load.{' '}
      <button type="button" className="linkbtn small tap" disabled={retrying} onClick={onRetry}>
        Try again
      </button>
    </p>
  )
}

/** The emergency fund's place: its card once started, the offer before, or why it waits. */
function EmergencySlot({
  goals,
  fund,
  onEdit,
}: {
  goals: Goal[]
  fund: EmergencyView | null
  onEdit: (goal: Goal) => void
}) {
  const goal = fund && goals.find((one) => one.id === fund.goalId)
  if (fund && goal) {
    return <EmergencyCard goal={goal} view={fund} onEdit={() => onEdit(goal)} />
  }
  if (fund && fund.goalId === null) return <EmergencyOffer view={fund} />
  return (
    <Card static="empty" label="Emergency fund">
      <p className="empty">{NO_FUND_YET}</p>
    </Card>
  )
}

/** What the goals list says with nothing in it, beside the buttons that start one. */
function NoGoals({ hasFund }: { hasFund: boolean }) {
  return (
    <Card static="empty" label="No goals">
      <p className="empty">
        {hasFund ? 'Nothing else saved for yet.' : 'No goals yet.'} Save for something you want to
        buy, and Leeway works out what to set aside for it.
      </p>
    </Card>
  )
}

/** Every goal but the fund, in the owner's order, under the buttons that start a new one. */
function YourGoals({
  goals,
  all,
  hasFund,
  today,
  onOpen,
}: {
  goals: Goal[]
  all: Goal[]
  hasFund: boolean
  today: string
  onOpen: (editing: Editing) => void
}) {
  return (
    <section className="stack" aria-label="Your goals">
      <div className="row-between wrap">
        <h2>Your goals</h2>
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            onClick={() => onOpen({ goal: null, kind: 'savings' })}
          >
            Add a goal
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => onOpen({ goal: null, kind: 'purchase' })}
          >
            Save for a purchase
          </button>
        </div>
      </div>
      {/* The fund is funded in the same order, so the order counts it too. */}
      {competing(all) && <GoalOrderCard today={today} />}
      {goals.length === 0 ? (
        <NoGoals hasFund={hasFund} />
      ) : (
        <div className="grid">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              today={today}
              onEdit={() => onOpen({ goal, kind: goal.kind })}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** A key that starts the form afresh for each goal, kind or filled-in draft it opens on. */
function editorKey({ goal, kind, draft }: Editing): string {
  if (goal) return goal.id
  return draft
    ? `new-${kind}-${draft.name}-${draft.targetCents}-${draft.targetDate}`
    : `new-${kind}`
}

export function GoalsSection({
  editing,
  onOpen,
  onClose,
}: {
  editing: Editing | null
  onOpen: (editing: Editing) => void
  onClose: () => void
}) {
  const goals = useAction('list_goals')
  const accounts = useAction('list_accounts')
  // Cash flow's date is the server's today.
  const cash = useAction('get_cash_flow')
  const emergency = useAction('get_emergency_fund')

  // Waits on the fund only while it loads: an error drops its card, never the goals.
  if (!goals.data || !accounts.data || !cash.data || emergency.isPending) {
    return <LoadingOrError error={goals.error ?? accounts.error ?? cash.error} />
  }
  const fund = emergency.data ?? null
  const fundGoalId = fund?.goalId ?? null
  // While the fund fails to load, its goal draws nothing: a plain card would
  // show a target the fund has not just worked out.
  const others = goals.data.filter(
    (goal) => goal.id !== fundGoalId && !(emergency.isError && goal.emergencyMonths !== null),
  )

  return (
    <>
      {editing && (
        <GoalEditor
          key={editorKey(editing)}
          editing={editing}
          accounts={accounts.data}
          emergency={fund}
          onClose={onClose}
        />
      )}
      {emergency.isError ? (
        <FundTrouble retrying={emergency.isFetching} onRetry={() => void emergency.refetch()} />
      ) : (
        <EmergencySlot
          goals={goals.data}
          fund={fund}
          onEdit={(goal) => onOpen({ goal, kind: goal.kind })}
        />
      )}
      <YourGoals
        goals={others}
        all={goals.data}
        hasFund={fundGoalId !== null}
        today={cash.data.today}
        onOpen={onOpen}
      />
    </>
  )
}
