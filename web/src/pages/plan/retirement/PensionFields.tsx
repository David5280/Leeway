// The pension form's building blocks: a labelled figure, a labelled choice,
// each with a one-line hint read out with it, and where a new pension goes.

import { useId } from 'react'
import { Setting } from '../../../components/ui'

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

/** A labelled list to choose from, its hint read with it like a figure's. */
export function Choice({
  label,
  name,
  hint,
  value,
  options,
  onChange,
}: {
  /** What the owner reads beside it. */
  label: string
  /** What a screen reader calls it, when the label alone would be unclear. */
  name?: string
  hint: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const hintId = useId()
  return (
    <Setting label={label} hint={hint} hintId={hintId}>
      <select
        className="input"
        aria-label={name ?? label}
        aria-describedby={hintId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Setting>
  )
}

/** Where a new pension goes: a new account, or one Leeway already has. */
export function PensionAccount({
  candidates,
  accountId,
  onChange,
}: {
  candidates: Candidate[]
  accountId: string
  onChange: (accountId: string) => void
}) {
  const options = [
    { value: '', label: 'A new pension' },
    ...candidates.map((account) => ({ value: account.id, label: account.name })),
  ]
  return (
    <Choice
      label="Add it to"
      hint="An account you already have, so it is not counted twice"
      value={accountId}
      options={options}
      onChange={onChange}
    />
  )
}
