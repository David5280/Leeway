// The names Chat must hide because a row that may pay a person is shown by
// a label (chat/people.ts finds them, modelLabels.ts labels them), and where
// each is hidden. Pure.
//
// Privacy comes first: when in doubt, a name is hidden. The labelled rows
// themselves never show their line, so the names read here are what to hide
// everywhere else: who the line names after "to" or "from", Plaid's merchant
// name unless the owner buys from it, and, on a payment app's line naming
// neither, what is left of it once the app, the movement words and the codes
// are gone. Account words stay in a name ("IRA ROTH" through Zelle is a person).

import {
  appIn,
  merchantOf,
  namesOwnAppAccount,
  personInLine,
  personWords,
} from '../betweenPeople.js'
import { isKnownShop, type KnownShops } from '../knownShops.js'
import type { LabelKind } from '../modelLabels.js'
import { nameAfterToOrFrom, type Movement } from '../transfers.js'
import { loneNamesOf, type NameSource } from './loneNames.js'

/** A name read from a labelled row, and where it came from. */
export interface FoundName extends NameSource {
  /** Read from a bank transfer, which often names the owner's own account. */
  transfer?: boolean
}

/** The names one labelled row could show its person under. */
export function namesIn(tx: Movement, kind: LabelKind, shops: KnownShops): FoundName[] {
  if (kind === 'unknown') return []
  const named = nameAfterToOrFrom(tx.name)
  const paid = named && !namesOwnAppAccount(named) ? personWords(named) : ''
  const merchant = merchantOf(tx)
  const shop = !merchant || appIn(merchant) !== null || isKnownShop(shops, merchant)
  const found: FoundName[] = [
    { name: paid, paid: kind === 'app' },
    { name: shop ? '' : personInLine(merchant) },
  ].filter(({ name }) => name)
  // A line naming no one after "to" or "from" may still hold them ("ZELLE; DOE, JANE").
  if (found.length === 0 && kind === 'app' && !named) found.push({ name: personInLine(tx.name) })
  return found
    .filter(({ name }) => name)
    .map((one) => (kind === 'transfer' ? { ...one, transfer: true } : one))
}

// A business's legal ending: "ACME PLUMBING LLC", or a practice's, "JANE DOE PC".
const BUSINESS_END = /\s+(?:llc|inc|co|corp|ltd|lp|pllc|pc|company)\.?$/i

// Words for an account, which a bank writes after the name of whose it is
// ("CLARA THORNBURY EVERYDAY CHECKING"), and which are never hidden alone.
const ACCOUNT_WORDS = new Set(
  (
    'account acct bank brokerage card cd checking chk credit debit everyday hsa joint loan ' +
    'market money mortgage saving savings share shares spend way2save'
  ).split(' '),
)

/** A name without the account words a bank wrote after it, or the same name. */
function withoutAccountWords(name: string): string {
  const words = name.trim().split(/\s+/)
  while (words.length > 1 && ACCOUNT_WORDS.has(words.at(-1)!.toLowerCase())) words.pop()
  return words.join(' ')
}

/**
 * Every form a name is hidden in: as written; without a business ending
 * ("Jane Doe Pc", "Jane Doe"), unless the business is a shop the owner buys
 * from; without the account words after it ("Clara Thornbury Everyday
 * Checking", "Clara Thornbury"); and with two words the other way round, as
 * banks write a surname first ("DUNMORE PERPETUA", "Halvorsen, Ingrid").
 */
function formsOf(name: string, shops: KnownShops): string[] {
  const bare = name.trim().replace(BUSINESS_END, '')
  if (bare !== name.trim() && (isKnownShop(shops, name) || isKnownShop(shops, bare))) return []
  const forms = new Set([name.trim(), bare, withoutAccountWords(bare)])
  for (const form of [...forms]) {
    const words = form.split(/\s+/)
    if (words.length === 2) forms.add(`${words[1]} ${words[0]}`)
  }
  return [...forms]
}

/** The names Chat hides outside the labelled rows, and where (loneNames.ts). */
export interface HiddenNames {
  /** Full names (two words or more), hidden wherever they are written, in any case. */
  names: string[]
  /** Single words of names, and names of one word, too short to hide in any case ("Bo"). */
  loneNames: string[]
  /** Single words of names long enough to hide in any case ("jane"). */
  loneAnyCase: string[]
  /** Common words an app named as the person paid ("Will"), hidden only in notes. */
  noteNames: string[]
}

/**
 * Where each name read from a labelled row is hidden outside those rows:
 *
 * - A full name (two words or more), in every form (formsOf), is hidden in
 *   every field, owner-written labels included (a category, goal, bill or
 *   rule called "Gifts for Jane Doe"), in any case, accents and joining aside.
 * - A single word, whether part of a full name or a name of one word, is
 *   hidden in every field too ("Kettering loan"), unless it is how a shop is
 *   called; a common word only in notes (loneNames.ts). A business ending
 *   ("Pc") or an account word ("Checking") is never one.
 * - A bank transfer often names the owner's own account, so a name read from
 *   one made only of their accounts' words is no one's, and those words are
 *   never hidden alone.
 */
export function namesToHide(
  found: readonly FoundName[],
  shops: KnownShops,
  ownAccountWords: ReadonlySet<string> = new Set(),
): HiddenNames {
  const notOwn = (word: string) => !ownAccountWords.has(word.toLowerCase())
  const kept = found.filter((one) => !one.transfer || one.name.split(/\s+/).some(notOwn))
  const names = [...new Set(kept.flatMap((one) => formsOf(one.name, shops)))]
  // Each word alone, but the words of a transfer's that name the owner's own accounts.
  const parts = kept.flatMap((one) =>
    formsOf(one.name, shops)
      .filter((form) => !BUSINESS_END.test(form))
      .map((form) => (one.transfer ? form.split(/\s+/).filter(notOwn).join(' ') : form))
      .map((name) => ({ ...one, name })),
  )
  const lone = loneNamesOf(parts, shops, ACCOUNT_WORDS)
  return {
    names: names.filter((name) => name.split(/\s+/).length > 1),
    loneNames: lone.capital,
    loneAnyCase: lone.anyCase,
    noteNames: lone.inNotes,
  }
}
