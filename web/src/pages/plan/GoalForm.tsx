// The form for adding or changing a savings goal.

import { useState, type FormEvent } from 'react'
import type { Account, Goal, Input } from '../../api/client'
import { ColorPicker } from '../../components/ColorPicker'
import { ErrorNote, Setting } from '../../components/ui'
import { parseMoney } from '../../lib/format'
import { CATEGORY_COLORS } from '../../lib/theme'

export type GoalFields = Required<Input<'create_goal'>>

const BY_HAND = ''

/** The form's starting text in each field, from a goal or blank for a new one. */
function startingValues(goal?: Goal) {
  return {
    name: goal?.name ?? '',
    target: goal ? String(goal.targetCents / 100) : '',
    saved: goal?.savedCents ? String(goal.savedCents / 100) : '',
    targetDate: goal?.targetDate ?? '',
    accountId: goal?.accountId ?? BY_HAND,
    color: goal?.color ?? CATEGORY_COLORS[0][1],
  }
}

export function GoalForm({
  goal,
  accounts,
  busy,
  error,
  onSubmit,
  onCancel,
  onDelete,
}: {
  goal?: Goal
  accounts: Account[]
  busy: boolean
  error: unknown
  onSubmit: (fields: GoalFields) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [start] = useState(() => startingValues(goal))
  const [name, setName] = useState(start.name)
  const [target, setTarget] = useState(start.target)
  const [saved, setSaved] = useState(start.saved)
  const [targetDate, setTargetDate] = useState(start.targetDate)
  const [accountId, setAccountId] = useState(start.accountId)
  const [color, setColor] = useState(start.color)
  const targetCents = parseMoney(target)
  // Only savings and checking accounts can hold money set aside for a goal.
  const savingsAccounts = accounts.filter((a) => a.type === 'depository' && !a.hidden)

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      name,
      targetCents: targetCents ?? 0,
      targetDate: targetDate || null,
      accountId: accountId || null,
      savedCents: Math.max(0, parseMoney(saved) ?? 0),
      color,
    })
  }

  return (
    <form className="stack" onSubmit={submit} aria-label={goal ? `Edit ${goal.name}` : 'New goal'}>
      <label className="field">
        Name
        <input
          className="input"
          required
          maxLength={80}
          placeholder="Like emergency fund"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <Setting label="Target">
        <input
          className="input num"
          style={{ width: 130 }}
          inputMode="decimal"
          required
          aria-label="Target amount"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </Setting>
      <Setting label="By" hint="Optional. Shows how much to set aside each month">
        <input
          className="input"
          type="date"
          aria-label="Target date"
          style={{ width: 'auto' }}
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
        />
      </Setting>
      <Setting label="Progress" hint="Follow an account's balance, or count it yourself">
        <select
          className="input"
          aria-label="Progress"
          style={{ width: 'auto' }}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value={BY_HAND}>Count it myself</option>
          {savingsAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              Follow {account.name}
            </option>
          ))}
        </select>
      </Setting>
      {accountId === BY_HAND && (
        <Setting label="Saved so far">
          <input
            className="input num"
            style={{ width: 130 }}
            inputMode="decimal"
            aria-label="Saved so far"
            placeholder="0"
            value={saved}
            onChange={(e) => setSaved(e.target.value)}
          />
        </Setting>
      )}
      <Setting label="Color">
        <ColorPicker value={color} onChange={setColor} />
      </Setting>
      <ErrorNote error={error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={busy || !targetCents}>
          {goal ? 'Save' : 'Add goal'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button type="button" className="btn danger" onClick={onDelete} disabled={busy}>
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
