// Where a reviewed paystub's figures go: a pension kept already, or the new
// pension being added from it (on an account Leeway has, or a new one), and,
// when the paystub shows one, the 401(k), 457 or 403(b) contribution as the
// monthly retirement saving.

import { useId } from 'react'
import type { AccountChoice } from '../fields'
import { LeftNote, leftOption, PensionAccount, type Candidate } from '../PensionFields'
import type { NewPensionText, PensionChoice } from './review'

/** The offer to make the 401(k), 457 and 403(b) figures the monthly retirement saving. */
function ContributionChoice({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="row small check check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Make the 401(k), 457 and 403(b) figures what you add to retirement savings each month
    </label>
  )
}

/** Using the figures on a kept pension, on the monthly contribution, or only keeping them. */
export function UseFigures({
  pensions,
  pension,
  onPension,
  plans,
  contribution,
  onContribution,
}: {
  pensions: PensionChoice[]
  /** The chosen pension's account id, or '' for none. */
  pension: string
  onPension: (accountId: string) => void
  /** Whether the paystub shows a 401(k), 457 or 403(b) figure to offer. */
  plans: boolean
  contribution: boolean
  onContribution: (checked: boolean) => void
}) {
  return (
    <fieldset className="review-group">
      <legend>Use these figures</legend>
      {pensions.length > 0 && (
        <label className="field">
          Update a pension with its contribution, gross pay, pay schedule and employer share
          <select className="input" value={pension} onChange={(e) => onPension(e.target.value)}>
            <option value="">No, keep the pension as it is</option>
            {pensions.map((choice) => (
              <option key={choice.accountId} value={choice.accountId}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {plans && <ContributionChoice checked={contribution} onChange={onContribution} />}
      {pensions.length === 0 && !plans && (
        <p className="small muted">Leeway keeps the figures with your paystubs.</p>
      )}
    </fieldset>
  )
}

/** The offer of the monthly contribution in a group of its own, beside the new pension. */
export function SavingChoice({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <fieldset className="review-group">
      <legend>Retirement saving</legend>
      <ContributionChoice checked={checked} onChange={onChange} />
    </fieldset>
  )
}

/**
 * The pension being added: on an account Leeway already has, when there is
 * one it could be, so it is not counted twice; or else a new account, named
 * from the paystub's pension line when Claude read one, with its member
 * balance, which no paystub shows.
 */
export function NewPensionFields({
  candidates,
  typed,
  choice,
  confirm,
  onChange,
}: {
  candidates: Candidate[]
  typed: NewPensionText
  /** Where the figures go, read against the accounts as listed now. */
  choice: AccountChoice
  /** The save button's words, which the note on a pension made meanwhile names. */
  confirm: string
  onChange: (change: Partial<NewPensionText>) => void
}) {
  const balanceId = useId()
  return (
    <fieldset className="review-group">
      <legend>Your new pension</legend>
      <p className="small muted">
        It takes the pension contribution, gross pay, pay schedule and employer share above.
      </p>
      {(candidates.length > 0 || typed.accountId !== '') && (
        <PensionAccount
          candidates={candidates}
          accountId={typed.accountId}
          left={leftOption(choice)}
          onChange={(accountId) => onChange({ accountId })}
        />
      )}
      <LeftNote choice={choice} confirm={confirm} />
      {/* An account Leeway already has keeps its own name and balance. */}
      {choice.kind === 'new' && (
        <div className="review-figures">
          <label className="field">
            Pension name
            <input
              className="input"
              required
              maxLength={80}
              placeholder="Like Colorado PERA"
              value={typed.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </label>
          {/* A div, not a label, so the hint is read as a description, not as part of the name. */}
          <div className="review-figure">
            <label htmlFor={balanceId}>Member balance</label>
            <input
              id={balanceId}
              className="input num"
              inputMode="decimal"
              aria-describedby={`${balanceId}-hint`}
              value={typed.balance}
              onChange={(e) => onChange({ balance: e.target.value })}
            />
            <small id={`${balanceId}-hint`} className="muted">
              Optional, from your plan&apos;s statement
            </small>
          </div>
        </div>
      )}
    </fieldset>
  )
}
