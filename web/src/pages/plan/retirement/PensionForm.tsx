// The form for a pension's figures, all optional: what each paycheck pays in,
// what the employer adds, and the benefit from the plan's statement or the
// salary, multiplier and service its formula uses. Leeway fills in nothing:
// a blank field stays not known.

import { useId, useState, type FormEvent } from 'react'
import { ErrorNote, Setting } from '../../../components/ui'
import {
  firstError,
  planText,
  readAmount,
  switchContribution,
  readPlan,
  type ContributionKind,
  type PensionPlan,
  type PlanChange,
  type PlanText,
} from './fields'

const CADENCES = [
  { value: '', label: 'My pay schedule' },
  { value: 'week', label: 'Every week' },
  { value: 'biweek', label: 'Every 2 weeks' },
  { value: 'semimonth', label: 'Twice a month' },
  { value: 'month', label: 'Monthly' },
] as const

const CONTRIBUTION_KINDS: { value: ContributionKind; label: string }[] = [
  { value: 'none', label: 'Not known yet' },
  { value: 'amount', label: 'An amount each paycheck' },
  { value: 'percent', label: 'A percent of gross pay' },
]

/**
 * What a new pension needs beyond its plan: the account it goes on when Leeway
 * already has one, or else a name and the member balance, if known.
 */
export interface NewPensionFields {
  accountId: string | null
  name: string
  balanceCents: number | null
}

/** An account a new pension's plan can go on. */
export interface Candidate {
  id: string
  name: string
}

/** Where a new pension goes: a new account, or one Leeway already has. */
function PensionAccount({
  candidates,
  accountId,
  onChange,
}: {
  candidates: Candidate[]
  accountId: string
  onChange: (accountId: string) => void
}) {
  return (
    <Setting label="Add it to" hint="An account you already have, so it is not counted twice">
      <select
        className="input"
        aria-label="Add it to"
        value={accountId}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">A new pension</option>
        {candidates.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
    </Setting>
  )
}

/** A labelled text input for one figure. */
function Figure({
  label,
  hint,
  value,
  onChange,
  type = 'decimal',
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  type?: 'decimal' | 'date'
}) {
  const hintId = useId()
  return (
    <Setting label={label} hint={hint} hintId={hintId}>
      <input
        className="input num figure"
        type={type === 'date' ? 'date' : 'text'}
        inputMode={type === 'date' ? undefined : 'decimal'}
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Setting>
  )
}

export function PensionForm({
  plan,
  isNew,
  candidates = [],
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  /** The figures kept so far; null for a new pension. */
  plan: PensionPlan | null
  /** A new pension also asks for its name and member balance. */
  isNew: boolean
  /** For a new pension: accounts Leeway already has that it could go on. */
  candidates?: Candidate[]
  busy: boolean
  error: unknown
  onSubmit: (change: PlanChange, created: NewPensionFields) => void
  onCancel: () => void
}) {
  const [text, setText] = useState<PlanText>(() => planText(plan))
  const [name, setName] = useState('')
  const [balance, setBalance] = useState('')
  // '' adds a new account; otherwise the id of the account the plan goes on.
  const [accountId, setAccountId] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const set = (field: keyof PlanText) => (value: string) =>
    setText((current) => ({ ...current, [field]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    const figures = readPlan(text)
    const member = readAmount(balance, 'the member balance')
    setProblem(firstError(figures, member))
    if (figures.ok && member.ok) {
      onSubmit(figures.value, { accountId: accountId || null, name, balanceCents: member.value })
    }
  }

  return (
    <form
      className="stack"
      onSubmit={submit}
      aria-label={isNew ? 'New pension' : 'Pension figures'}
    >
      <p className="small muted">
        Enter figures from your plan&apos;s statement or website. Leave any you do not know blank;
        Leeway never fills them in.
      </p>
      {isNew && candidates.length > 0 && (
        <PensionAccount candidates={candidates} accountId={accountId} onChange={setAccountId} />
      )}
      {isNew && !accountId && (
        <>
          <label className="field">
            Name
            <input
              className="input"
              required
              maxLength={80}
              placeholder="Like Colorado PERA"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Figure label="Member balance" hint="Optional" value={balance} onChange={setBalance} />
        </>
      )}
      <h3>What goes in</h3>
      <Setting label="Your contribution">
        <select
          className="input"
          aria-label="Contribution type"
          value={text.contributionKind}
          onChange={(e) => setText((current) => switchContribution(current, e.target.value))}
        >
          {CONTRIBUTION_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </Setting>
      {text.contributionKind !== 'none' && (
        <Figure
          label={text.contributionKind === 'amount' ? 'Amount each paycheck' : 'Percent of pay'}
          value={text.contribution}
          onChange={set('contribution')}
        />
      )}
      <Figure
        label="Gross pay each paycheck"
        hint="Turns a percent into an amount"
        value={text.grossPay}
        onChange={set('grossPay')}
      />
      <Setting label="Paid">
        <select
          className="input"
          aria-label="Pay schedule"
          value={text.payCadence}
          onChange={(e) => set('payCadence')(e.target.value)}
        >
          {CADENCES.map((cadence) => (
            <option key={cadence.value} value={cadence.value}>
              {cadence.label}
            </option>
          ))}
        </select>
      </Setting>
      <Figure
        label="Employer adds, percent of pay"
        value={text.employerPercent}
        onChange={set('employerPercent')}
      />
      <h3>What it pays</h3>
      <Figure
        label="Monthly benefit from your statement"
        hint="Used ahead of the formula"
        value={text.statementBenefit}
        onChange={set('statementBenefit')}
      />
      <Figure label="Years of service" value={text.serviceYears} onChange={set('serviceYears')} />
      <Figure
        label="Monthly salary the formula uses"
        hint="Such as your highest average salary"
        value={text.salaryBasis}
        onChange={set('salaryBasis')}
      />
      <Figure
        label="Multiplier, percent per year"
        hint="From your plan, such as 2.5"
        value={text.multiplier}
        onChange={set('multiplier')}
      />
      <Figure
        label="Benefit starts at age"
        hint="Blank uses your retirement age"
        value={text.benefitAge}
        onChange={set('benefitAge')}
      />
      <Figure
        label="Checked on"
        hint="When you last checked these"
        value={text.checkedOn}
        onChange={set('checkedOn')}
        type="date"
      />
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
      <ErrorNote error={error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={busy}>
          {isNew ? 'Add pension' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
