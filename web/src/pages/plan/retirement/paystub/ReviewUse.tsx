// Where a reviewed paystub's figures go: a pension kept already, or the new
// pension being added from it, and, when the paystub shows one, the 401(k),
// 457 or 403(b) contribution as the monthly retirement saving.

import { useId } from 'react'
import type { PensionChoice } from './review'

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

/**
 * The pension being added: its name, offered from the paystub's pension line
 * when Claude read one, and its member balance, which no paystub shows.
 */
export function NewPensionFields({
  name,
  onName,
  balance,
  onBalance,
  plans,
  contribution,
  onContribution,
}: {
  name: string
  onName: (name: string) => void
  balance: string
  onBalance: (balance: string) => void
  plans: boolean
  contribution: boolean
  onContribution: (checked: boolean) => void
}) {
  const balanceId = useId()
  return (
    <fieldset className="review-group">
      <legend>Your new pension</legend>
      <p className="small muted">
        It takes the pension contribution, gross pay, pay schedule and employer share above.
      </p>
      <div className="review-figures">
        <label className="field">
          Pension name
          <input
            className="input"
            required
            maxLength={80}
            placeholder="Like Colorado PERA"
            value={name}
            onChange={(e) => onName(e.target.value)}
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
            value={balance}
            onChange={(e) => onBalance(e.target.value)}
          />
          <small id={`${balanceId}-hint`} className="muted">
            Optional, from your plan&apos;s statement
          </small>
        </div>
      </div>
      {plans && <ContributionChoice checked={contribution} onChange={onContribution} />}
    </fieldset>
  )
}
