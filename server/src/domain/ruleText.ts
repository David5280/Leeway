// The text an assistant's rule or bill reads: a transaction's own name as the
// app shows it. Pure.
//
// An assistant never sees the bank's text, only display names, so the rules
// it makes or rewrites read only this (see RuleReads in rules.ts), and so do
// the bills it adds or re-patterns (bills.ts) and the keys it is given for
// repeating charges (recurring.ts). The name is built as every name is
// (transactionName.ts) and checked against every account's mask
// (safeName.ts), so nothing an assistant writes can find an account's digits
// in it, and nothing it changes can show which transactions hold them.
//
// It is the display name with two differences, since it must not depend on
// the category that rules are deciding:
// - a transfer paired between two accounts keeps its own name, not
//   "Checking to Savings", which it is shown under once filed as a transfer;
// - a name with nothing readable left never takes the category's name.

import { personPayment } from './betweenPeople.js'
import type { Rule } from './rules.js'
import type { AccountMasks } from './safeName.js'
import { safePerson, transactionDisplayName, type NameableTransaction } from './transactionName.js'
import type { Movement } from './transfers.js'

/**
 * A transaction's own name as shown, before any category: '' where the app
 * would fall back to the category's name. Its `person` is the one the app
 * shows (safePerson).
 */
export function shownName(tx: NameableTransaction, masks: AccountMasks): string {
  return transactionDisplayName(tx, null, { masks, fallback: '' })
}

/**
 * A stored transaction's own name as shown, with the person it pays or is
 * paid by worked out from its bank fields, as the Activity list shows it.
 */
export function shownNameOf(row: Movement, masks: AccountMasks): string {
  return shownName({ ...row, person: safePerson(personPayment(row), masks) }, masks)
}

/**
 * Each stored row with the shown name a rule reads beside its bank text.
 * Worked out only when some rule reads it; with none, every shown name is ''
 * and no rule looks at it.
 */
export function withShownNames<T extends Movement>(
  rows: readonly T[],
  rules: readonly Rule[],
  masks: AccountMasks,
): (T & { shownName: string })[] {
  const needed = rules.some((rule) => rule.reads === 'shown_name')
  return rows.map((row) => ({
    ...row,
    shownName: needed ? shownNameOf(row, masks) : '',
  }))
}
