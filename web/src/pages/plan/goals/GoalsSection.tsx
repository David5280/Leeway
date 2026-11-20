// The Goals section of the Plan tab: savings goals and purchases being saved
// for, with what each budget period needs and whether recent progress makes it.
// "/plan/goals?new=purchase" opens straight onto a new purchase, which is how
// the overview's "Save for a purchase" link gets here.

import { Card } from '../../../components/design/Card'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Account, Goal } from '../../../api/client'
import { useAction, useActionMutation } from '../../../api/hooks'
import { LoadingOrError } from '../../../components/ui'
import { FormCard } from '../FormCard'
import { GoalCard } from './GoalCard'
import { GoalForm, type GoalFields, type GoalKind } from './GoalForm'

/** What the form is open on: a new goal of a kind, or an existing goal. */
interface Editing {
  goal: Goal | null
  kind: GoalKind
}

/** The form's heading: the goal's name, or what kind of goal is being started. */
function titleOf({ goal, kind }: Editing): string {
  if (goal) return goal.name
  return kind === 'purchase' ? 'Save for a purchase' : 'New goal'
}

/** The open form, with the changes it can save. */
function GoalEditor({
  editing,
  accounts,
  onClose,
}: {
  editing: Editing
  accounts: Account[]
  onClose: () => void
}) {
  const { goal, kind } = editing
  const create = useActionMutation('create_goal')
  const update = useActionMutation('update_goal')
  const remove = useActionMutation('delete_goal')
  const close = { onSuccess: onClose }
  const save = (fields: GoalFields) =>
    goal ? update.mutate({ id: goal.id, ...fields }, close) : create.mutate(fields, close)
  return (
    <FormCard title={titleOf(editing)}>
      <GoalForm
        goal={goal ?? undefined}
        kind={kind}
        accounts={accounts}
        busy={create.isPending || update.isPending || remove.isPending}
        error={create.error ?? update.error ?? remove.error}
        onSubmit={save}
        onCancel={onClose}
        onDelete={goal ? () => remove.mutate({ id: goal.id }, close) : undefined}
      />
    </FormCard>
  )
}

export function GoalsSection() {
  const [params, setParams] = useSearchParams()
  // Opened from a link that asks for a new purchase; otherwise nothing is open.
  const [editing, setEditing] = useState<Editing | null>(() =>
    params.get('new') === 'purchase' ? { goal: null, kind: 'purchase' } : null,
  )
  const goals = useAction('list_goals')
  const accounts = useAction('list_accounts')
  // The Plan screen loads cash flow anyway; its date is the server's today.
  const cash = useAction('get_cash_flow')

  if (!goals.data || !accounts.data || !cash.data) {
    const error = goals.error ?? accounts.error ?? cash.error
    return <LoadingOrError error={error} />
  }

  function close() {
    setEditing(null)
    // Drop "?new=purchase" so a reload does not open the form again.
    if (params.has('new')) setParams({}, { replace: true })
  }

  return (
    <>
      {editing && (
        <GoalEditor
          key={editing.goal?.id ?? `new-${editing.kind}`}
          editing={editing}
          accounts={accounts.data}
          onClose={close}
        />
      )}

      <div className="row-between wrap">
        <h2>Goals</h2>
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
      {goals.data.length === 0 ? (
        <Card static="empty" label="No goals">
          <p className="empty">
            No goals yet. Save for something you want to buy, or start an emergency fund of one
            month of spending.
          </p>
        </Card>
      ) : (
        <div className="grid">
          {goals.data.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              today={cash.data.today}
              onEdit={() => setEditing({ goal, kind: goal.kind })}
            />
          ))}
        </div>
      )}
    </>
  )
}
