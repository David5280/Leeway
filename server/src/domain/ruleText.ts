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

import { shownPerson } from './betweenPeople.js'
import type { Rule } from './rules.js'
import type { AccountMasks } from './safeName.js'
import { safePerson, transactionDisplayName, type NameableTransaction } from './transactionName.js'
import { earlierPersonPayment, type Movement } from './transfers.js'

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
  return shownName({ ...row, person: safePerson(shownPerson(row), masks) }, masks)
}

/**
 * Every name a stored row has been shown under: its name now (shownNameOf),
 * and the one the app gave it before it read who was paid more closely
 * ("To Jane Doe On Ref" is now "To Jane Doe"). A pattern or key an assistant
 * saved from the earlier name still finds the row by it.
 */
export function shownNamesOf(row: Movement, masks: AccountMasks): string[] {
  const earlier = shownName({ ...row, person: safePerson(earlierPersonPayment(row), masks) }, masks)
  return [...new Set([shownNameOf(row, masks), earlier])]
}

/**
 * Each stored row with the shown names a rule reads beside its bank text
 * (shownNamesOf), its name now first. Worked out only when some rule reads
 * them; with none, the shown name is '' and no rule looks at it.
 */
export function withShownNames<T extends Movement>(
  rows: readonly T[],
  rules: readonly Rule[],
  masks: AccountMasks,
): (T & { shownName: string; shownNames: string[] })[] {
  const needed = rules.some((rule) => rule.reads === 'shown_name')
  return rows.map((row) => {
    const shownNames = needed ? shownNamesOf(row, masks) : ['']
    return { ...row, shownName: shownNames[0]!, shownNames }
  })
}
