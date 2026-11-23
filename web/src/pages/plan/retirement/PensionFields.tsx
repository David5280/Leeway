// The pension form's building blocks: a labelled figure, a labelled choice,
// each with a one-line hint read out with it, and where a new pension goes.

import { useId } from 'react'
import { Setting } from '../../../components/ui'
import type { AccountChoice } from './fields'

/** An account a new pension's plan can go on. */
export interface Candidate {
  id: string
  name: string
}

/** A labelled text input for one figure, its hint read with it by a screen reader. */
export function Figure({
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

/** A labelled list to choose from, named by its visible label, its hint read with it like a figure's. */
export function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint: string
  value: string
  /** A disabled option shows but cannot be chosen, such as a prompt to choose again. */
  options: readonly { value: string; label: string; disabled?: boolean }[]
  onChange: (value: string) => void
}) {
  const hintId = useId()
  return (
    <Setting label={label} hint={hint} hintId={hintId}>
      <select
        className="input"
        aria-label={label}
        aria-describedby={hintId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Setting>
  )
}

/** The label of the choice of where a new pension goes, which focus returns to after a retry. */
export const ACCOUNT_CHOICE_LABEL = 'Add it to'

/**
 * Where a new pension goes: a new account, or one Leeway already has. An
 * account chosen that has since left the list stays chosen, under the label
 * given in `left`, so the choice never changes without the owner.
 */
export function PensionAccount({
  candidates,
  accountId,
  left,
  onChange,
}: {
  candidates: Candidate[]
  accountId: string
  left?: { label: string; disabled: boolean }
  onChange: (accountId: string) => void
}) {
  const options = [
    ...(left ? [{ value: accountId, ...left }] : []),
    { value: '', label: 'A new pension' },
    ...candidates.map((account) => ({ value: account.id, label: account.name })),
  ]
  return (
    <Choice
      label={ACCOUNT_CHOICE_LABEL}
      hint="An account you already have, so it is not counted twice"
      value={accountId}
      options={options}
      onChange={onChange}
    />
  )
}

/**
 * How an account chosen that has since left the list shows in the choice: a
 * pension now, whose figures it can still take, or a prompt to choose again.
 */
export function leftOption(
  choice: AccountChoice,
): { label: string; disabled: boolean } | undefined {
  if (choice.kind === 'kept') return { label: `Update ${choice.name}`, disabled: false }
  if (choice.kind === 'gone') return { label: 'Choose again', disabled: true }
  return undefined
}

/** Said plainly when the account chosen has left the list, so the change is never silent. */
export function LeftNote({ choice, confirm }: { choice: AccountChoice; confirm: string }) {
  if (choice.kind === 'kept') {
    return (
      <p className="notice" role="status">
        {choice.name} is a pension already, so {confirm} puts these figures on it instead of adding
        a second pension.
      </p>
    )
  }
  if (choice.kind !== 'gone') return null
  return (
    <p className="notice" role="status">
      The account you chose can no longer take a pension. Choose where it goes.
    </p>
  )
}
