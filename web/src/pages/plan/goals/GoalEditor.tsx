// The goal form as Goals opens it: on an existing goal, on a new goal of a
// kind, or on a new purchase started from a link or from the afford check.
// "/goals?new=purchase" opens straight onto a new purchase, which is how the
// overview's "Save for a purchase" link gets here; Coming up adds the event's
// name, price and day (&name=, &price= in cents, &by=) to start from.

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Account, Goal } from '../../../api/client'
import { useActionMutation } from '../../../api/hooks'
import type { EmergencyView } from '../../../lib/emergencyText'
import { FormCard } from '../FormCard'
import { GoalForm, type GoalDraft, type GoalFields, type GoalKind } from './GoalForm'

/** What the form is open on: a new goal of a kind, or an existing goal. */
export interface Editing {
  goal: Goal | null
  kind: GoalKind
  /** What a new goal starts from, when whatever opened it says. */
  draft?: GoalDraft
}

/** A new purchase as the address asks for it, or nothing open. */
export function editingFrom(params: URLSearchParams): Editing | null {
  if (params.get('new') !== 'purchase') return null
  const price = Number(params.get('price'))
  const draft = {
    name: params.get('name') ?? '',
    targetCents: Number.isInteger(price) && price > 0 ? price : null,
    targetDate: params.get('by') ?? '',
  }
  return { goal: null, kind: 'purchase', draft }
}

/**
 * Which goal form is open, starting from the address, with a way to open
 * another and to close it. Closing drops "?new=purchase" and what came with
 * it, so a reload does not open the form again.
 */
export function useGoalEditing() {
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(() => editingFrom(params))
  function close() {
    setEditing(null)
    if (params.has('new')) setParams({}, { replace: true })
  }
  return { editing, open: setEditing, close }
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
export function GoalEditor({
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
