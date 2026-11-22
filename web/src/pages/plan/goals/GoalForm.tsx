// The form for adding or changing a goal: a savings goal (an emergency fund,
// a trip) or a purchase being saved for (an item, its price, a date to buy by).

import { useState, type FormEvent } from 'react'
import type { Account, Goal, Input } from '../../../api/client'
import { ColorPicker } from '../../../components/ColorPicker'
import { ErrorNote, Setting, Switch } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { parseMoney, periodWord } from '../../../lib/format'
import { CATEGORY_COLORS } from '../../../lib/theme'

export type GoalFields = Required<Input<'create_goal'>>
export type GoalKind = GoalFields['kind']

const BY_HAND = ''

/** The words that change with the kind of goal; everything else reads the same. */
const WORDING = {
  savings: {
    form: 'New goal',
    name: 'Name',
    placeholder: 'Like emergency fund',
    target: 'Target',
    targetLabel: 'Target amount',
    date: 'By',
    submit: 'Add goal',
  },
  purchase: {
    form: 'New purchase',
    name: 'What are you saving for?',
    placeholder: 'Like a road bike',
    target: 'Price',
    targetLabel: 'Price',
    date: 'Buy by',
    submit: 'Start saving',
  },
} as const

/** What a new goal can start from: an event coming up, say. */
export interface GoalDraft {
  name: string
  targetCents: number | null
  targetDate: string
}

/** The name, price and date to start from: the goal's own, or a draft's (or blank) for a new one. */
function startingText(goal?: Goal, draft?: GoalDraft) {
  if (goal) {
    return {
      name: goal.name,
      target: String(goal.targetCents / 100),
      targetDate: goal.targetDate ?? '',
    }
  }
  return {
    name: draft?.name ?? '',
    target: draft?.targetCents ? String(draft.targetCents / 100) : '',
    targetDate: draft?.targetDate ?? '',
  }
}

/** The form's starting text in each field, from a goal, a draft, or blank for a new one. */
function startingValues(goal?: Goal, draft?: GoalDraft) {
  return {
    ...startingText(goal, draft),
    saved: goal?.savedCents ? String(goal.savedCents / 100) : '',
    accountId: goal?.accountId ?? BY_HAND,
    color: goal?.color ?? CATEGORY_COLORS[0][1],
    setAside: goal?.setAside ?? false,
  }
}

export function GoalForm({
  goal,
  kind,
  draft,
  accounts,
  busy,
  error,
  onSubmit,
  onCancel,
  onDelete,
}: {
  goal?: Goal
  /** The kind of a new goal; an existing goal keeps its own. */
  kind: GoalKind
  /** What a new goal starts from, instead of blank. */
  draft?: GoalDraft
  accounts: Account[]
  busy: boolean
  error: unknown
  onSubmit: (fields: GoalFields) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const { settings } = useApp()
  const [start] = useState(() => startingValues(goal, draft))
  const [name, setName] = useState(start.name)
  const [target, setTarget] = useState(start.target)
  const [saved, setSaved] = useState(start.saved)
  const [targetDate, setTargetDate] = useState(start.targetDate)
  const [accountId, setAccountId] = useState(start.accountId)
  const [color, setColor] = useState(start.color)
  const [setAside, setSetAside] = useState(start.setAside)
  const goalKind = goal?.kind ?? kind
  const words = WORDING[goalKind]
  const period = periodWord(settings.period.kind)
  const targetCents = parseMoney(target)
  // Only savings and checking accounts can hold money set aside for a goal.
  const savingsAccounts = accounts.filter((a) => a.type === 'depository' && !a.hidden)

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      name,
      kind: goalKind,
      targetCents: targetCents ?? 0,
      targetDate: targetDate || null,
      accountId: accountId || null,
      savedCents: Math.max(0, parseMoney(saved) ?? 0),
      color,
      // Setting money aside needs a date to divide by; the server says so too.
      setAside: setAside && Boolean(targetDate),
    })
  }

  return (
    <form className="stack" onSubmit={submit} aria-label={goal ? `Edit ${goal.name}` : words.form}>
      <label className="field">
        {words.name}
        <input
          className="input"
          required
          maxLength={80}
          placeholder={words.placeholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <Setting label={words.target}>
        <input
          className="input num"
          style={{ width: 130 }}
          inputMode="decimal"
          required
          aria-label={words.targetLabel}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </Setting>
      <Setting label={words.date} hint={`Optional. Shows what to set aside each ${period}`}>
        <input
          className="input"
          type="date"
          aria-label="Target date"
          style={{ width: 'auto' }}
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
        />
      </Setting>
      <Setting
        label="Set aside from my budget"
        hint={
          targetDate
            ? `Holds each ${period}'s share out of Your leeway, so it is not spent`
            : 'Give it a date first, so there is a share to hold back'
        }
      >
        <Switch
          label="Set aside from my budget"
          checked={setAside && Boolean(targetDate)}
          disabled={!targetDate}
          onChange={setSetAside}
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
          {goal ? 'Save' : words.submit}
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
