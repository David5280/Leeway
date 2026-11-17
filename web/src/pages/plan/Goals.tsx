// Savings goals: progress toward each, and what it takes each month to get there.

import { useState } from 'react'
import type { Account, Goal } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { Card, ErrorNote, Loading, Progress } from '../../components/ui'
import { useApp } from '../../lib/app'
import { parseMoney } from '../../lib/format'
import { FormCard } from './FormCard'
import { GoalForm, type GoalFields } from './GoalForm'
import { goalText } from './text'

/** Put money toward a goal counted by hand, or take some back with a minus sign. */
function AddMoney({ goal }: { goal: Goal }) {
  const [amount, setAmount] = useState('')
  const add = useActionMutation('add_to_goal')
  const cents = parseMoney(amount)
  return (
    <form
      className="row wrap"
      aria-label={`Add to ${goal.name}`}
      onSubmit={(event) => {
        event.preventDefault()
        add.mutate({ id: goal.id, amountCents: cents! }, { onSuccess: () => setAmount('') })
      }}
    >
      <input
        className="input num"
        style={{ width: 110 }}
        inputMode="decimal"
        aria-label={`Amount to add to ${goal.name}`}
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button type="submit" className="btn" disabled={!cents || add.isPending}>
        Add
      </button>
      <ErrorNote error={add.error} />
    </form>
  )
}

function GoalCard({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const { money, settings } = useApp()
  return (
    <Card label={goal.name} className="span-6 stack-sm">
      <div className="row-between">
        <h2>{goal.name}</h2>
        <button type="button" className="linkbtn" onClick={onEdit}>
          Edit
        </button>
      </div>
      <div className="row wrap" style={{ alignItems: 'baseline' }}>
        <span className="num mid-number">{money(goal.currentCents)}</span>
        <span className="muted">of {money(goal.targetCents)}</span>
      </div>
      <Progress percent={goal.percent} color={goal.color} label={`${goal.name} progress`} />
      <span className="small">{goalText(goal, money, settings.locale)}</span>
      {goal.accountId ? (
        <span className="small muted">Follows the balance of {goal.accountName}.</span>
      ) : (
        <AddMoney goal={goal} />
      )}
    </Card>
  )
}

/** The open form, with the changes it can save. A null goal means a new one. */
function GoalEditor({
  goal,
  accounts,
  onClose,
}: {
  goal: Goal | null
  accounts: Account[]
  onClose: () => void
}) {
  const create = useActionMutation('create_goal')
  const update = useActionMutation('update_goal')
  const remove = useActionMutation('delete_goal')
  const close = { onSuccess: onClose }
  const save = (fields: GoalFields) =>
    goal ? update.mutate({ id: goal.id, ...fields }, close) : create.mutate(fields, close)
  return (
    <FormCard title={goal ? goal.name : 'New goal'}>
      <GoalForm
        goal={goal ?? undefined}
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
  // undefined: no form open; null: a new goal; a goal: editing that one.
  const [editing, setEditing] = useState<Goal | null | undefined>(undefined)
  const goals = useAction('list_goals')
  const accounts = useAction('list_accounts')

  if (!goals.data || !accounts.data) {
    const error = goals.error ?? accounts.error
    return error ? <ErrorNote error={error} /> : <Loading />
  }

  return (
    <>
      {editing !== undefined && (
        <GoalEditor
          key={editing?.id ?? 'new'}
          goal={editing}
          accounts={accounts.data}
          onClose={() => setEditing(undefined)}
        />
      )}

      <div className="row-between wrap">
        <h2>Savings goals</h2>
        <button type="button" className="btn primary" onClick={() => setEditing(null)}>
          Add a goal
        </button>
      </div>
      {goals.data.length === 0 ? (
        <Card label="No goals">
          <p className="empty">
            No goals yet. An emergency fund of one month of spending is a good first one.
          </p>
        </Card>
      ) : (
        <div className="grid">
          {goals.data.map((goal) => (
            <GoalCard key={goal.id} goal={goal} onEdit={() => setEditing(goal)} />
          ))}
        </div>
      )}
    </>
  )
}
