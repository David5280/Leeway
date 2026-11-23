// The names Chat must hide because a row that may pay a person is shown by
// a label (chat/people.ts finds them, modelLabels.ts labels them), and where
// each is hidden. Pure.
//
// Privacy comes first: when in doubt, a name is hidden. The labelled rows
// themselves never show their line, so the names read here are what to hide
// everywhere else: who the line names after "to" or "from", Plaid's merchant
// name unless the owner buys from it, and, on a line naming no one that way,
// what is left of it once the app, the words for how money moved, a bank's
// own words and the codes are gone. Account words stay in a name ("IRA ROTH"
// through Zelle is a person). A line is read as it shows (plainLetters.ts),
// so look-alike letters and invisible characters hide no name, and a name a
// bank wrote "HALVORSEN/INGRID" reads as two words.

import {
  appIn,
  merchantOf,
  namesOwnAppAccount,
  personInLine,
  personWords,
} from '../betweenPeople.js'
import { isBusinessWord } from '../businessWords.js'
import { isKnownShop, type KnownShops } from '../knownShops.js'
import type { LabelKind } from '../modelLabels.js'
import { withoutCredential } from '../personShape.js'
import { plainLetters } from '../plainLetters.js'
import { nameAfterToOrFrom, type Movement } from '../transfers.js'
import { loneNamesOf, type NameSource } from './loneNames.js'

/** A name read from a labelled row, and where it came from. */
export interface FoundName extends NameSource {
  /** Read from a bank transfer, which often names the owner's own account. */
  transfer?: boolean
}

// What banks write around a name on a line that is no app's, beyond the
// words for how money moved: "BILL PAY", "BNF=", "ON-LINE", "CHECK 1043",
// a clinician's title. None of them is a name to hide.
const BANK_WORDS = new Set(
  (
    'autopay bill bnf check chk dds domestic dr lcsw lpc md mr mrs ms on-line online pay ' +
    'phd psyd'
  ).split(' '),
)

/** Whether a word is one a bank writes around a name ("CHECK", "BILL PAY"), never a name. */
export function isBankWord(word: string): boolean {
  return BANK_WORDS.has(word.toLowerCase())
}

/** A bank's text as names are read from it: as it shows, with "/" between words ("DOE/JANE"). */
function readable(text: string): string {
  return plainLetters(text).replace(/(?<=\p{L})\/(?=\p{L})/gu, ' ')
}

/**
 * The words of a line that is no app's that could be a name: personInLine,
 * less a bank's words and what a business or bill is called ("Jane Doe
 * babysitting" reads "Jane Doe").
 */
function nameInLine(line: string): string {
  const words = personInLine(line).split(' ')
  const kept = words.filter((word) => !BANK_WORDS.has(word.toLowerCase()) && !isBusinessWord(word))
  return personWords(kept.join(' '))
}

/** The names one labelled row could show its person under. */
export function namesIn(tx: Movement, kind: LabelKind, shops: KnownShops): FoundName[] {
  const line = readable(tx.name)
  const merchant = merchantOf({ ...tx, merchantName: readable(tx.merchantName ?? '') })
  const named = nameAfterToOrFrom(line)
  const paid = named && !namesOwnAppAccount(named) ? personWords(named) : ''
  const shop = !merchant || appIn(merchant) !== null || isKnownShop(shops, merchant)
  const found: FoundName[] = [
    { name: paid, paid: kind === 'app' },
    { name: shop ? '' : personInLine(merchant) },
  ]
  // A line naming no one after "to" or "from" may still hold them ("ZELLE; DOE, JANE",
  // "BILL PAY JANE DOE"), unless it is a shop the owner buys from ("MARIGOLD CAFE
  // 0042"); an app's is read only when nothing else named them.
  const inLine = !named && kind !== 'app' ? nameInLine(line) : ''
  const aShop = [inLine, personInLine(line)].some((name) => isKnownShop(shops, name))
  if (inLine && !aShop) found.push({ name: inLine })
  if (!named && kind === 'app' && !found.some(({ name }) => name)) {
    found.push({ name: personInLine(line) })
  }
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
    'market money mortgage sav saving savings share shares spend svgs way2save'
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
 * from; without a credential after it ("Corwin Ashby DC", "Corwin Ashby");
 * without the account words after it ("Clara Thornbury Everyday Checking",
 * "Clara Thornbury"); and with two words the other way round, as banks write
 * a surname first ("DUNMORE PERPETUA", "Halvorsen, Ingrid").
 */
function formsOf(name: string, shops: KnownShops): string[] {
  const bare = name.trim().replace(BUSINESS_END, '')
  if (bare !== name.trim() && (isKnownShop(shops, name) || isKnownShop(shops, bare))) return []
  const forms = new Set([name.trim(), bare, withoutCredential(bare), withoutAccountWords(bare)])
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

/** Words without a second of any in any case, first kept: "JANE" and "Jane" are one. */
function unique(words: readonly string[]): string[] {
  const seen = new Set<string>()
  return words.filter((word) => !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()))
}

/**
 * The hidden names with the words of the owner's labels that could be a
 * name (ownerText.ts) added, each hidden alone as a name's single word is.
 */
export function withOwnerWords(
  hidden: HiddenNames,
  ownerWords: readonly string[],
  shops: KnownShops,
): HiddenNames {
  const owner = loneNamesOf(
    ownerWords.map((name) => ({ name })),
    shops,
    ACCOUNT_WORDS,
  )
  const anyCase = unique([...hidden.loneAnyCase, ...owner.anyCase])
  const inAnyCase = new Set(anyCase.map((word) => word.toLowerCase()))
  const capital = unique([...hidden.loneNames, ...owner.capital])
  return {
    ...hidden,
    loneAnyCase: anyCase,
    loneNames: capital.filter((word) => !inAnyCase.has(word.toLowerCase())),
  }
}
