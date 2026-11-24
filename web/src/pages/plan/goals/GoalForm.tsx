// The form for adding or changing a goal: a savings goal (an emergency fund,
// a trip) or a purchase being saved for (an item, its price, a date to buy by).

import { useState, type FormEvent } from 'react'
import type { Account, Goal, Input } from '../../../api/client'
import { ColorPicker } from '../../../components/ColorPicker'
import { ErrorNote, Setting, Switch } from '../../../components/ui'
import { AmountNote, useAmountField, type AmountField } from '../../../components/AmountNote'
import { useApp } from '../../../lib/app'
import { followHint, fundTargetHint, type EmergencyView } from '../../../lib/emergencyText'
import { parseMoney, periodWord } from '../../../lib/format'
import { CATEGORY_COLORS } from '../../../lib/theme'
import { BY_HAND, ProgressFields } from './ProgressFields'
import { TripTarget } from './TripGoal'

export type GoalFields = Required<Input<'create_goal'>>
export type GoalKind = GoalFields['kind']

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
 * The target and saved-so-far fields, and whether either keeps Save off.
 * Neither amount is ever negative. Saved so far counts only when kept by
 * hand, and then one that can't be read, or a negative one, must not save as $0.
 */
function useGoalAmounts(target: string, saved: string, keptByHand: boolean) {
  const targetField = useAmountField(target, { min: 0 })
  const savedField = useAmountField(saved, { min: 0 })
  const targetCents = parseMoney(target)
  const badTarget = !targetCents || targetField.note !== null
  const badSaved = keptByHand && savedField.note !== null
  return { targetField, savedField, targetCents, blocked: badTarget || badSaved }
}

/**
 * A goal's target and date. A trip budget's goal takes both from its budget,
 * which the server keeps to, so its form points to the trip's page instead.
 */
function TargetFields({
  goal,
  words,
  hint,
  period,
  target,
  targetField,
  targetDate,
  onTarget,
  onTargetDate,
}: {
  goal: Goal | undefined
  words: (typeof WORDING)[GoalKind]
  hint: string | undefined
  period: string
  target: string
  targetField: AmountField
  targetDate: string
  onTarget: (text: string) => void
  onTargetDate: (date: string) => void
}) {
  if (goal?.trip) return <TripTarget goal={goal} />
  return (
    <>
      <Setting label={words.target} hint={hint}>
        <input
          className="input num"
          style={{ width: 130 }}
          inputMode="decimal"
          required
          aria-label={words.targetLabel}
          {...targetField.inputProps}
          value={target}
          onChange={(e) => onTarget(e.target.value)}
        />
      </Setting>
      <AmountNote id={targetField.id} text={targetField.shown} />
      <Setting label={words.date} hint={`Optional. Shows what to set aside each ${period}`}>
        <input
          className="input"
          type="date"
          aria-label="Target date"
          style={{ width: 'auto' }}
          value={targetDate}
          onChange={(e) => onTargetDate(e.target.value)}
        />
      </Setting>
    </>
  )
}

export function GoalForm({
  goal,
  kind,
  draft,
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
  /** What a new goal starts from, instead of blank. */
  draft?: GoalDraft
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
  // Only savings and checking accounts can hold money set aside for a goal.
  const savingsAccounts = accounts.filter((a) => a.type === 'depository' && !a.hidden)
  // The emergency fund counts the accounts picked on its own card.
  const followsSavings = goal?.emergencyMonths !== null && goal?.emergencyMonths !== undefined
  const hints = fundHints(goal, emergency, accountId)
  const amounts = useGoalAmounts(target, saved, !followsSavings && accountId === BY_HAND)
  const { targetField, savedField, targetCents } = amounts

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      name,
      kind: goalKind,
      targetCents: targetCents ?? 0,
      targetDate: targetDate || null,
      accountId: accountId || null,
      // Kept by hand, a negative amount keeps Save off; followed, it is not sent below $0.
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
      <TargetFields
        goal={goal}
        words={words}
        hint={hints.target}
        period={period}
        target={target}
        targetField={targetField}
        targetDate={targetDate}
        onTarget={setTarget}
        onTargetDate={setTargetDate}
      />
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
          savedField={savedField}
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
        <button type="submit" className="btn primary" disabled={busy || amounts.blocked}>
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
