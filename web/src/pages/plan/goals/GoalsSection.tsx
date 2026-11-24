// The Goals tab's content, most general first: the emergency fund
// offer while there is none, then which goal comes first and when each lands,
// then each goal (purchases being saved for among them) with what each budget
// period needs and whether recent progress makes it.
// "/goals?new=purchase" opens straight onto a new purchase, which is how
// the overview's "Save for a purchase" link gets here; Coming up adds the
// event's name, price and day (&name=, &price= in cents, &by=) to start from.
// When the fund alone fails to load, the goals still show, with a way to try
// the fund again.

import { Card } from '../../../components/design/Card'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Account, Goal } from '../../../api/client'
import { useAction, useActionMutation } from '../../../api/hooks'
import { LoadingOrError } from '../../../components/ui'
import { FormCard } from '../FormCard'
import { EmergencyCard, EmergencyOffer } from './EmergencyFund'
import type { EmergencyView } from '../../../lib/emergencyText'
import { GoalCard } from './GoalCard'
import { GoalForm, type GoalDraft, type GoalFields, type GoalKind } from './GoalForm'
import { GoalOrderCard } from './GoalOrder'

/** What the form is open on: a new goal of a kind, or an existing goal. */
interface Editing {
  goal: Goal | null
  kind: GoalKind
  /** What a new goal starts from, when the link that opened it says. */
  draft?: GoalDraft
}

/** A new purchase as the address asks for it, or nothing open. */
function editingFrom(params: URLSearchParams): Editing | null {
  if (params.get('new') !== 'purchase') return null
  const price = Number(params.get('price'))
  const draft = {
    name: params.get('name') ?? '',
    targetCents: Number.isInteger(price) && price > 0 ? price : null,
    targetDate: params.get('by') ?? '',
  }
  return { goal: null, kind: 'purchase', draft }
}

/** The form's heading: the goal's name, or what kind of goal is being started. */
function titleOf({ goal, kind }: Editing): string {
  if (goal) return goal.name
  return kind === 'purchase' ? 'Save for a purchase' : 'New goal'
}

/**
 * A goal's save, leaving out a target the form left as it opened: the
 * emergency fund's target grows with essentials, so sending back the one the
 * form showed would read as the owner typing their own.
 */
function changesTo(goal: Goal, fields: GoalFields) {
  const { targetCents, ...rest } = fields
  return targetCents === goal.targetCents ? { id: goal.id, ...rest } : { id: goal.id, ...fields }
}

/** The open form, with the changes it can save. */
function GoalEditor({
  editing,
  accounts,
  emergency,
  onClose,
}: {
  editing: Editing
  accounts: Account[]
  emergency: EmergencyView | null
  onClose: () => void
}) {
  const { goal, kind, draft } = editing
  const create = useActionMutation('create_goal')
  const update = useActionMutation('update_goal')
  const remove = useActionMutation('delete_goal')
  const close = { onSuccess: onClose }
  const save = (fields: GoalFields) =>
    goal ? update.mutate(changesTo(goal, fields), close) : create.mutate(fields, close)
  return (
    <FormCard title={titleOf(editing)}>
      <GoalForm
        goal={goal ?? undefined}
        kind={kind}
        draft={draft}
        accounts={accounts}
        emergency={emergency}
        busy={create.isPending || update.isPending || remove.isPending}
        error={create.error ?? update.error ?? remove.error}
        onSubmit={save}
        onCancel={onClose}
        onDelete={goal ? () => remove.mutate({ id: goal.id }, close) : undefined}
      />
    </FormCard>
  )
}

/**
 * Every goal's card, in the owner's order; the emergency fund draws its own.
 * While the fund fails to load, its goal draws nothing, since a plain card
 * would show a target the fund has not just worked out.
 */
function GoalCards({
  goals,
  emergency,
  fundFailed,
  today,
  onEdit,
}: {
  goals: Goal[]
  emergency: EmergencyView | null
  fundFailed: boolean
  today: string
  onEdit: (goal: Goal) => void
}) {
  const shown = fundFailed ? goals.filter((goal) => goal.emergencyMonths === null) : goals
  return (
    <div className="grid">
      {shown.map((goal) =>
        // The fund's goal, marked or only named as one, draws the fund's card.
        emergency && goal.id === emergency.goalId ? (
          <EmergencyCard key={goal.id} goal={goal} view={emergency} onEdit={() => onEdit(goal)} />
        ) : (
          <GoalCard key={goal.id} goal={goal} today={today} onEdit={() => onEdit(goal)} />
        ),
      )}
    </div>
  )
}

/** Goals still being saved for compete for the same money; two or more make an order worth setting. */
const competing = (goals: Goal[]) =>
  goals.filter((goal) => goal.status === 'in_progress' || goal.status === 'past_due').length >= 2

/**
 * How a first goal starts: the emergency fund offer when there is one,
 * otherwise, with no goals yet, a line on what to save for. While the fund
 * fails to load, neither offers it, since the retry beside them says so and
 * an offer from an earlier load may be out of date.
 */
function GoalsStart({
  goals,
  emergency,
  fundFailed,
}: {
  goals: Goal[]
  emergency: EmergencyView | null
  fundFailed: boolean
}) {
  if (!fundFailed && emergency && emergency.goalId === null) {
    return <EmergencyOffer view={emergency} />
  }
  if (goals.length > 0) return null
  return (
    <Card static="empty" label="No goals">
      <p className="empty">
        {fundFailed
          ? 'No goals yet. Save for something you want to buy.'
          : 'No goals yet. Save for something you want to buy, or start an emergency fund once a month of spending is in.'}
      </p>
    </Card>
  )
}

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

export function GoalsSection() {
  const [params, setParams] = useSearchParams()
  // Opened from a link that asks for a new purchase; otherwise nothing is open.
  const [editing, setEditing] = useState(() => editingFrom(params))
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

  function close() {
    setEditing(null)
    // Drop "?new=purchase" and what came with it, so a reload does not open the form again.
    if (params.has('new')) setParams({}, { replace: true })
  }

  return (
    <>
      {editing && (
        <GoalEditor
          key={editing.goal?.id ?? `new-${editing.kind}`}
          editing={editing}
          accounts={accounts.data}
          emergency={fund}
          onClose={close}
        />
      )}

      <div className="row-between wrap">
        <h1>Goals</h1>
        <div className="row wrap">
          <button
            type="button"
            className="btn"
            onClick={() => setEditing({ goal: null, kind: 'savings' })}
          >
            Add a goal
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => setEditing({ goal: null, kind: 'purchase' })}
          >
            Save for a purchase
          </button>
        </div>
      </div>
      {emergency.isError && (
        <FundTrouble retrying={emergency.isFetching} onRetry={() => void emergency.refetch()} />
      )}
      <GoalsStart goals={goals.data} emergency={fund} fundFailed={emergency.isError} />
      {competing(goals.data) && <GoalOrderCard today={cash.data.today} />}
      <GoalCards
        goals={goals.data}
        emergency={fund}
        fundFailed={emergency.isError}
        today={cash.data.today}
        onEdit={(goal) => setEditing({ goal, kind: goal.kind })}
      />
    </>
  )
}
