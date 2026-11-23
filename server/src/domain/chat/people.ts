// Everything Chat keeps out of what it sends a model (chat/toolOutput.ts):
// which rows are shown by a label instead of their name, the names those rows
// could show a person under, and the bills that track them.
//
// Chat hides by default (modelLabels.ts): a row's own name reaches the model
// only when it is surely a purchase from a business. Every other row is
// labelled ("Zelle payment (sent)", "Service payment"), and what it would
// have been shown as is replaced by that label wherever else it is written.
// The names read from the labelled rows (personNames.ts), and the words of
// the owner's own labels that could be a name (ownerText.ts), are hidden
// everywhere too, and no search may find them (chat/searchGuard.ts).

import type { Db } from '../../db/pool.js'
import { accountMasks } from '../accounts.js'
import { GENERIC_NAME } from '../merchantName.js'
import { bankTextKey, textKey } from '../merchantKey.js'
import { neutralLabel, type LabelSubject, type RowLabel } from '../modelLabels.js'
import { isMovementWord } from '../movementWords.js'
import { isKnownShop, NO_SHOPS, type KnownShops } from '../knownShops.js'
import { shopsIn } from '../peopleContext.js'
import { shownNameOf } from '../ruleText.js'
import type { AccountMasks } from '../safeName.js'
import { merchantDisplayName } from '../transactionName.js'
import { labelBills, wordsOf, type BillShown, type StoredBill } from './billLabels.js'
import { ownerLabels, namesInLabels } from './ownerText.js'
import { shownWordsOf } from './shownText.js'
import {
  isBankWord,
  namesIn,
  namesToHide,
  withOwnerWords,
  type HiddenNames,
} from './personNames.js'

/** Text a labelled row hides, in lower case, beside its label, for refusing a search. */
export interface HiddenText {
  text: string
  label: string
}

/** What Chat keeps out of a model's sight, and what it shows instead. */
export interface PaymentPeople extends HiddenNames {
  /** The label each labelled transaction is shown by, by id. */
  rows: ReadonlyMap<string, RowLabel>
  /** How each bill tracking labelled rows is shown, by id. */
  bills: ReadonlyMap<string, BillShown>
  /**
   * What labelled rows and renamed bills would have been shown as, each
   * beside the label replacing it wherever it is written, longest first.
   */
  phrases: readonly (readonly [phrase: string, label: string])[]
  /** The hidden names' words that could find one alone, in lower case without accents (wordsOf). */
  hiddenWords: readonly string[]
  /** What labelled rows hide, so a search for it is refused (chat/searchGuard.ts). */
  hiddenTexts: readonly HiddenText[]
  /**
   * Every word of the owner's account names, in lower case: a single word of
   * a name that is one of these is hidden only in notes, so account names stay.
   */
  accountWords: readonly string[]
  /** The owner's account masks, hidden wherever they are written (a goal "Pay off card 4417"). */
  masks: readonly string[]
  /** The shops the owner buys from, which a search may always look for. */
  shops: KnownShops
  /**
   * The words of the rows shown by name (wordsOf), which a note may hold: a
   * word Chat shows anyway is no hidden name (but see shownText.ts).
   */
  shownWords: ReadonlySet<string>
}

/** No row labelled, no name and no bill hidden: nothing is replaced. */
export const NO_PEOPLE: PaymentPeople = {
  names: [],
  loneNames: [],
  loneAnyCase: [],
  noteNames: [],
  rows: new Map(),
  bills: new Map(),
  phrases: [],
  hiddenWords: [],
  hiddenTexts: [],
  accountWords: [],
  masks: [],
  shops: NO_SHOPS,
  shownWords: new Set(),
}

type Row = LabelSubject & { id: string; note: string | null }
type Labelled = RowLabel & { tx: Row }

/**
 * Every transaction, as labelling reads it. Each one is labelled unless it
 * may show its name, so none is left out by a guess at what it is: narrowing
 * the scan by its words would be the list of a person's shapes this replaces.
 */
async function allRows(db: Db): Promise<Row[]> {
  const { rows } = await db.query<Row>(
    `SELECT id::text, name, merchant_name AS "merchantName", amount_cents AS "amountCents",
       provider_category_primary AS "providerCategoryPrimary",
       provider_category_detailed AS "providerCategoryDetailed", note,
       merchant_entity_id AS "merchantEntityId",
       (provider_transaction_id IS NULL) AS "typedOrImported"
     FROM transactions`,
  )
  return rows
}

/** The owner's bills, as labelling reads them. */
async function storedBills(db: Db): Promise<StoredBill[]> {
  const { rows } = await db.query<StoredBill>(
    `SELECT id::text, name, match_pattern AS "matchPattern", reads FROM bills`,
  )
  return rows
}

/**
 * Every word of the names the bank gave the owner's accounts, in lower case,
 * which a transfer's line names. Nicknames and the accounts added by hand
 * (owned and owed, loans, pensions) are the owner's own words, which may
 * name someone ("Loan from Jane Doe"), so they never make a word an account's.
 */
async function ownAccountWords(db: Db): Promise<Set<string>> {
  const { rows } = await db.query<{ names: string }>(
    `SELECT concat_ws(' ', name, official_name) AS names FROM accounts
     WHERE connection_id IS NOT NULL`,
  )
  return new Set(rows.flatMap((row) => wordsOf(row.names)))
}

/** What a labelled row would have been shown as: its shown name, and its merchant's. */
function shownForms(tx: Row, masks: AccountMasks): string[] {
  return [shownNameOf(tx, masks), merchantDisplayName(tx, { masks })]
}

/** What a phrase is checked against: the owner's account words and the names hidden anyway. */
interface PhraseContext {
  masks: AccountMasks
  ownWords: ReadonlySet<string>
  /** Hidden names and words in lower case, which "someone" replaces instead. */
  names: ReadonlySet<string>
  /** The shops the owner buys from, whose names show wherever they are written. */
  shops: KnownShops
}

/**
 * Whether a shown name is worth replacing by its label: it has a word beyond
 * how money moved, a bank's own words and the owner's own accounts
 * ("Transfer to Ally Savings" names no one, and account names stay, and
 * "Check" is a word), and it is neither the label, a
 * hidden name already, nor a shop the owner buys from (a "MARIGOLD CAFE 0042"
 * with no code beside the café's coded purchases).
 */
function worthReplacing(phrase: string, label: string, context: PhraseContext): boolean {
  const plain = phrase.toLowerCase()
  if (phrase === GENERIC_NAME || plain === label.toLowerCase() || context.names.has(plain)) {
    return false
  }
  if (isKnownShop(context.shops, phrase)) return false
  // A bank's own words ("Check") name no one, and are too often meant as words.
  const named = (word: string) => !isMovementWord(word) && !isBankWord(word)
  return wordsOf(phrase).some((word) => named(word) && !context.ownWords.has(word))
}

/** Each labelled row's shown names and renamed bill's name, beside its label, longest first. */
function phrasesOf(
  labelled: readonly Labelled[],
  bills: readonly StoredBill[],
  shown: ReadonlyMap<string, BillShown>,
  context: PhraseContext,
): [string, string][] {
  const phrases = new Map<string, string>()
  for (const { tx, label } of labelled) {
    for (const phrase of shownForms(tx, context.masks)) {
      if (worthReplacing(phrase, label, context) && !phrases.has(phrase)) phrases.set(phrase, label)
    }
  }
  for (const bill of bills) {
    const how = shown.get(bill.id)
    if (how?.renamed) phrases.set(bill.name, how.label)
  }
  return [...phrases].sort(([a], [b]) => b.length - a.length)
}

/**
 * What each labelled row hides from a search: its shown names, its line and
 * merchant, and the note of a payment through an app, which is never shown.
 */
function hiddenTextsOf(labelled: readonly Labelled[], masks: AccountMasks): HiddenText[] {
  const texts = new Map<string, HiddenText>()
  for (const { tx, label, kind } of labelled) {
    const note = kind === 'app' ? tx.note : null
    for (const text of [...shownForms(tx, masks), tx.name, tx.merchantName, note]) {
      const hidden = { text: (text ?? '').toLowerCase(), label: label.toLowerCase() }
      if (hidden.text) texts.set(`${hidden.text}\n${hidden.label}`, hidden)
    }
  }
  return [...texts.values()]
}

/**
 * The words a hidden word could be searched by (wordsOf), two letters or
 * more, and a hyphenated one run together too: "Mary-Kate" is "mary",
 * "kate" and "marykate"; the "o" of "O'Brien" alone would refuse too much.
 */
function searchWordsOf(word: string): string[] {
  const words = wordsOf(word)
  const joined = words.length > 1 && word.includes('-') ? [words.join('')] : []
  return [...words, ...joined].filter((one) => one.length >= 2)
}

/** The words a name could be found by alone: no account or movement word, nor a lone letter. */
function searchWords(hidden: HiddenNames): string[] {
  const alone = [...hidden.loneNames, ...hidden.loneAnyCase, ...hidden.noteNames]
  return [...new Set(alone.flatMap(searchWordsOf))]
}

/** Every hidden name and word, in lower case. */
function hiddenSet(hidden: HiddenNames): Set<string> {
  const all = [...hidden.names, ...hidden.loneNames, ...hidden.loneAnyCase, ...hidden.noteNames]
  return new Set(all.map((name) => name.toLowerCase()))
}

/** The words of the rows shown by name: their lines, merchants and shown names (shownWordsOf). */
function wordsShownIn(rows: readonly Row[], masks: AccountMasks): Set<string> {
  return shownWordsOf(
    rows.flatMap((tx) => [tx.name, tx.merchantName ?? '', ...shownForms(tx, masks)]),
  )
}

/** Every labelled row, bill and name Chat hides from a model, and what it shows instead. */
export async function paymentPeople(db: Db): Promise<PaymentPeople> {
  const [rows, bills, labels] = await Promise.all([allRows(db), storedBills(db), ownerLabels(db)])
  const [masks, ownWords] = await Promise.all([accountMasks(db), ownAccountWords(db)])
  const shops = shopsIn(rows)
  const labelled = rows.flatMap((tx): Labelled[] => {
    const label = neutralLabel(tx, shops)
    return label ? [{ tx, ...label }] : []
  })
  const labelledIds = new Set(labelled.map(({ tx }) => tx.id))
  const shownWords = wordsShownIn(
    rows.filter((tx) => !labelledIds.has(tx.id)),
    masks,
  )
  // A label's word is plain when Chat shows it anyway, or it names the owner's own accounts.
  const plain = (word: string) => shownWords.has(word) || ownWords.has(word)
  const found = labelled.flatMap(({ tx, kind }) => namesIn(tx, kind, shops))
  const ofPeople = namesToHide(found, shops, ownWords)
  const hidden = withOwnerWords(ofPeople, namesInLabels(labels, plain, shops), shops)
  const hiddenWords = searchWords(hidden)
  // A bill's payments are money out, matched by its pattern's whole words.
  const payments = labelled
    .filter(({ tx }) => tx.amountCents > 0)
    .map(({ tx, label }) => ({
      label,
      bankKey: bankTextKey(tx),
      shownKey: textKey(shownNameOf(tx, masks)),
    }))
  // Only a name read from a labelled row makes a bill track a person, never the bill's own words.
  const shown = labelBills(bills, payments, new Set(searchWords(ofPeople)), hidden.names)
  return {
    ...hidden,
    rows: new Map(labelled.map(({ tx, label, kind }) => [tx.id, { label, kind }])),
    bills: shown,
    phrases: phrasesOf(labelled, bills, shown, {
      masks,
      ownWords,
      names: hiddenSet(hidden),
      shops,
    }),
    hiddenWords,
    hiddenTexts: hiddenTextsOf(labelled, masks),
    accountWords: [...ownWords],
    masks,
    shops,
    shownWords,
  }
}
