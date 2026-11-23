// The line a money field shows when what was typed can't be saved, shared by
// every form that takes an amount: one that can't be read ("5k"), or one the
// field doesn't take (a negative budget). The form keeps Save off from the
// first keystroke, but the line waits until the field is left or Enter is
// pressed, so it doesn't flash while "$" or "1.234,56" is still being typed.

import { useId, useState, type KeyboardEvent } from 'react'
import { amountNote, type AmountRules } from '../lib/amountNote'

/** A money field's note, live and as shown, and what ties its input to it. */
export interface AmountField {
  /** Why the amount can't be saved, as typed right now: Save waits on this. */
  note: string | null
  /** The note as the line shows it: only once the field has been left. */
  shown: string | null
  /** The line's id. */
  id: string
  /** Shows the note from now on, for a field that leaves in its own way. */
  reveal: () => void
  /** For the input: names the line, marks it invalid, and shows the note on leaving. */
  inputProps: {
    'aria-invalid': boolean
    'aria-describedby': string
    onBlur: () => void
    onKeyDown: (event: KeyboardEvent) => void
  }
}

/**
 * The note for a field holding `text`. Pass `lineId` for a second field
 * that shares another's line, as a pair of limits does.
 */
export function useAmountField(text: string, rules?: AmountRules, lineId?: string): AmountField {
  const ownId = useId()
  const id = lineId ?? ownId
  const [left, setLeft] = useState(false)
  const note = amountNote(text, rules)
  const shown = left ? note : null
  const reveal = () => setLeft(true)
  return {
    note,
    shown,
    id,
    reveal,
    inputProps: {
      'aria-invalid': shown !== null,
      'aria-describedby': id,
      onBlur: reveal,
      onKeyDown: (event) => {
        if (event.key === 'Enter') reveal()
      },
    },
  }
}

/**
 * The line itself. It keeps its height while empty, so nothing moves when
 * the note shows; in a long list of fields (`fit`) it takes room only then.
 */
export function AmountNote({
  id,
  text,
  fit = false,
}: {
  id: string
  text: string | null
  fit?: boolean
}) {
  return (
    <span id={id} className={fit ? 'small over amount-note fit' : 'small over amount-note'}>
      {text !== null && <span role="alert">{text}</span>}
    </span>
  )
}
