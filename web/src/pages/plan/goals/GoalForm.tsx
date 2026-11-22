// The form for adding or changing a goal: a savings goal (an emergency fund,
// a trip) or a purchase being saved for (an item, its price, a date to buy by).

import { useState, type FormEvent } from 'react'
import type { Account, Goal, Input } from '../../../api/client'
import { ColorPicker } from '../../../components/ColorPicker'
import { ErrorNote, Setting, Switch } from '../../../components/ui'
import { UnreadableAmount } from '../../../components/UnreadableAmount'
import { useApp } from '../../../lib/app'
import { followHint, fundTargetHint, type EmergencyView } from '../../../lib/emergencyText'
import { isUnreadableMoney, parseMoney, periodWord } from '../../../lib/format'
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

/** The form's starting text in each field, from a goal or blank for a new one. */
function startingValues(goal?: Goal) {
  return {
    name: goal?.name ?? '',
    target: goal ? String(goal.targetCents / 100) : '',
    saved: goal?.savedCents ? String(goal.savedCents / 100) : '',
    targetDate: goal?.targetDate ?? '',
    accountId: goal?.accountId ?? BY_HAND,
    color: goal?.color ?? CATEGORY_COLORS[0][1],
    setAside: goal?.setAside ?? false,
  }
}

/** Where a goal's progress comes from: an account's balance, or a count kept by hand. */
function ProgressFields({
  accounts,
  accountId,
  saved,
  note,
  onAccount,
  onSaved,
}: {
  accounts: Account[]
  accountId: string
  saved: string
  /** A line under the choice, like the emergency fund losing the account picked. */
  note: string | null
  onAccount: (id: string) => void
  onSaved: (text: string) => void
}) {
  return (
    <>
      <Setting label="Progress" hint="Follow an account's balance, or count it yourself">
        <select
          className="input"
          aria-label="Progress"
          style={{ width: 'auto' }}
          value={accountId}
          onChange={(e) => onAccount(e.target.value)}
        >
          <option value={BY_HAND}>Count it myself</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              Follow {account.name}
            </option>
          ))}
        </select>
      </Setting>
      {note && <p className="small muted">{note}</p>}
      {accountId === BY_HAND && (
        <Setting label="Saved so far">
          <input
            className="input num"
            style={{ width: 130 }}
            inputMode="decimal"
            aria-label="Saved so far"
            placeholder="0"
            value={saved}
            onChange={(e) => onSaved(e.target.value)}
          />
        </Setting>
      )}
      {accountId === BY_HAND && <UnreadableAmount text={saved} />}
    </>
  )
}

/**
 * The emergency fund's hints in a goal's form: how the fund's own target is
 * sized, and, on another goal, that following an account the fund counts
 * leaves it out of the fund.
 */
function fundHints(goal: Goal | undefined, emergency: EmergencyView | null, accountId: string) {
  const isFund = goal !== undefined && emergency !== null && goal.id === emergency.goalId
  return {
    target: isFund ? fundTargetHint(emergency) : undefined,
    follow: followHint(emergency, goal?.id ?? null, accountId),
  }
}

/**
 * Whether saved so far holds an amount that can't be read. It counts only
 * when kept by hand, and then one that can't be read must not save as $0.
 */
function savedIsUnreadable(saved: string, accountId: string, followsSavings: boolean): boolean {
  return !followsSavings && accountId === BY_HAND && isUnreadableMoney(saved)
}

export function GoalForm({
  goal,
  kind,
  accounts,
  emergency = null,
  busy,
  error,
  onSubmit,
  onCancel,
  onDelete,
}: {
  goal?: Goal
  /** The kind of a new goal; an existing goal keeps its own. */
  kind: GoalKind
  accounts: Account[]
  /** The emergency fund, for the hints on its own target and on the accounts it counts. */
  emergency?: EmergencyView | null
  busy: boolean
  error: unknown
  onSubmit: (fields: GoalFields) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const { settings } = useApp()
  const [start] = useState(() => startingValues(goal))
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
  // The emergency fund counts the accounts picked on its own card.
  const followsSavings = goal?.emergencyMonths !== null && goal?.emergencyMonths !== undefined
  const hints = fundHints(goal, emergency, accountId)
  const badSaved = savedIsUnreadable(saved, accountId, followsSavings)

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
      <Setting label={words.target} hint={hints.target}>
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
      <UnreadableAmount text={target} />
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
      {!followsSavings && (
        <ProgressFields
          accounts={savingsAccounts}
          accountId={accountId}
          saved={saved}
          note={hints.follow}
          onAccount={setAccountId}
          onSaved={setSaved}
        />
      )}
      <Setting label="Color">
        <ColorPicker value={color} onChange={setColor} />
      </Setting>
      <ErrorNote error={error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={busy || !targetCents || badSaved}>
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
