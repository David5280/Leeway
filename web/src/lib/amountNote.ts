// Why a typed amount can't be saved, in the words its field shows: one that
// can't be read ("5k"), or one the field doesn't take (a negative budget).
// Kept free of React so form logic can ask too; components/AmountNote.tsx
// shows the words under the field.

import { parseMoney } from './typedMoney'

/** What a field says for an amount that can't be read. */
export const UNREADABLE_AMOUNT = "Couldn't read that amount."

/** What it says for a negative amount in a field that never takes one. */
export const NEGATIVE_AMOUNT = "The amount can't be negative."

/** The amounts a field takes, in cents. */
export interface AmountRules {
  /** The least it takes: 0 for an amount that is never negative. */
  min?: number
  /** The most it takes. */
  max?: number
  /** What to say outside min to max; by default, that it can't be negative. */
  rangeNote?: string
}

/**
 * Why `text` can't be saved under `rules`, or null when it can. A blank
 * field may mean none on purpose, so it has nothing to say.
 */
export function amountNote(text: string, rules: AmountRules = {}): string | null {
  if (text.trim() === '') return null
  const cents = parseMoney(text)
  if (cents === null) return UNREADABLE_AMOUNT
  const { min, max, rangeNote = NEGATIVE_AMOUNT } = rules
  const outside = (min !== undefined && cents < min) || (max !== undefined && cents > max)
  return outside ? rangeNote : null
}
