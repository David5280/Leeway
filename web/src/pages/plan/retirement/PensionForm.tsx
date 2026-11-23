// The form for a pension. Adding one asks for its name and, if known, its
// member balance; every plan figure is optional and folded under "More
// details" (PensionDetails.tsx), so the form stays short until asked for
// more. Changing a kept pension shows its figures open. Leeway fills in
// nothing: a blank field stays not known.

import { useState, type FormEvent } from 'react'
import { ErrorNote } from '../../../components/ui'
import {
  firstError,
  planText,
  readAmount,
  readPlan,
  type PensionPlan,
  type PlanChange,
  type PlanText,
} from './fields'
import { PensionDetails } from './PensionDetails'
import { Figure, PensionAccount, type Candidate } from './PensionFields'

export type { Candidate }

/**
 * What a new pension needs beyond its plan: the account it goes on when Leeway
 * already has one, or else a name and the member balance, if known.
 */
export interface NewPensionFields {
  accountId: string | null
  name: string
  balanceCents: number | null
}

/** A new pension's name and member balance: the two things asked first. */
function NameAndBalance({
  name,
  balance,
  onName,
  onBalance,
}: {
  name: string
  balance: string
  onName: (name: string) => void
  onBalance: (balance: string) => void
}) {
  return (
    <>
      <label className="field">
        Name
        <input
          className="input"
          required
          maxLength={80}
          placeholder="Like Colorado PERA"
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
      </label>
      <Figure
        label="Member balance"
        hint="Optional, from your plan's statement"
        value={balance}
        onChange={onBalance}
      />
    </>
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
      {isNew && candidates.length > 0 && (
        <PensionAccount candidates={candidates} accountId={accountId} onChange={setAccountId} />
      )}
      {/* An account Leeway already has keeps its own name and balance. */}
      {isNew && !accountId && (
        <NameAndBalance name={name} balance={balance} onName={setName} onBalance={setBalance} />
      )}
      {/* A kept pension's figures are what its form is for, so they start open. */}
      <PensionDetails text={text} setText={setText} startOpen={plan !== null} />
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
