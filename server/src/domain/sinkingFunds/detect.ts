// Finding the yearly and irregular costs worth a sinking fund, from what
// Leeway already knows. Pure: the bills and the history come in;
// suggestions come out, each with what it is based on.
//
// Three signs, surest first:
// - a bill the owner tracks that comes due yearly or quarterly;
// - one large charge about a year ago whose words say it renews (insurance,
//   a registration, a membership), not seen again since;
// - December spending well above a usual month: the holidays.
//
// A charge repeating yearly that no bill tracks yet is left to the bill
// suggestions (untrackedRecurring.ts): once tracked, it comes back here as
// a bill, so the same charge is never offered in two places.

import { createHash } from 'node:crypto'
import { dateParts, daysBetween, makeDate, type IsoDate } from '../../lib/dates.js'
import { median } from '../../lib/money.js'
import { addCadence } from '../../lib/periods.js'
import type { Bill } from '../bills.js'
import { merchantKey, textKey } from '../merchantKey.js'
import type { PastTransaction } from '../recurringSeries.js'
import { FUND_CADENCES, type FundCadence } from './math.js'

/** What a suggestion is based on, for the words beside it. */
export type FundBasis = 'bill' | 'renewal' | 'holidays'

export interface FundSuggestion {
  /** Stable, so adding or dismissing it keeps it from coming back. */
  key: string
  /** The bill it follows, for a bill's suggestion; added by this id. */
  billId: string | null
  name: string
  /** What it comes to each time. */
  amountCents: number
  cadence: FundCadence
  /** When it is next expected. */
  dueDate: IsoDate
  basis: FundBasis
  /** Set when the name could be anyone's: what a model is shown instead (modelLabels.ts). */
  modelLabel?: string
}

/** How a charge is shown: its name, and the label a model reads in its place when needed. */
export interface ShownCharge {
  name: string
  modelLabel?: string
}

/** The key the holidays suggestion is kept under. */
export const HOLIDAYS_KEY = 'holidays'

/** A renewal charge this large or more is worth saving for; smaller ones fit in a month. */
export const RENEWAL_MIN_CENTS = 5_000

/** Words a charge that renews once a year usually carries. */
const RENEWAL_WORDS =
  /\b(insurance|insur|premium|registration|dmv|motor vehicle|renewal|annual|membership|tuition|license|licence|property tax)\b/i

/** A renewal looks yearly when it was this many days ago: about a year, give or take. */
const RENEWAL_WINDOW = { least: 300, most: 400 }

/** December counts as a holiday spike when it beats a usual month by this much and this share. */
export const HOLIDAY_MIN_CENTS = 15_000
const HOLIDAY_MIN_SHARE = 0.15

/** Months of other spending needed before a usual month can be said. */
const USUAL_MONTHS = 4

/** The holidays amount is rounded up to this, so it reads as a plan, not a receipt. */
const HOLIDAY_ROUND_CENTS = 5_000

export const isFundCadence = (cadence: string): cadence is FundCadence =>
  (FUND_CADENCES as readonly string[]).includes(cadence)

/** The key a bill's suggestion is kept under. */
export const billKey = (billId: string) => `bill:${billId}`

/**
 * The key a charge's suggestion is kept under: a digest of the name the app
 * shows, written like an id. Stable, so a dismissal sticks, and holding no
 * name, so Chat can hand it to a model whole (chat/toolOutput.ts keeps ids
 * as they are) while the model reads the suggestion by its label.
 */
export function shownKey(name: string): string {
  const hex = createHash('sha256').update(textKey(name)).digest('hex')
  const parts = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20)]
  return [...parts, hex.slice(20, 32)].join('-')
}

/** Bills the owner tracks that come due yearly or quarterly. */
export function billFunds(bills: Bill[]): FundSuggestion[] {
  return bills.flatMap((bill) =>
    isFundCadence(bill.cadence)
      ? [
          {
            key: billKey(bill.id),
            billId: bill.id,
            name: bill.name,
            amountCents: bill.amountCents,
            cadence: bill.cadence,
            dueDate: bill.nextDueDate,
            basis: 'bill' as const,
          },
        ]
      : [],
  )
}

/**
 * One large charge about a year ago that reads like a renewal, from a
 * merchant not charged since: likely due again around the same day.
 * `shown` gives how the app shows a charge, or null for money sent to a
 * person or moved between accounts, which is never a cost to save for.
 */
export function renewalFunds<T extends PastTransaction>(
  history: T[],
  today: IsoDate,
  shown: (tx: T) => ShownCharge | null,
): FundSuggestion[] {
  // History is oldest first, so the last charge kept per merchant is its newest.
  const newestByKey = new Map<string, T>()
  for (const tx of history) {
    const key = tx.amountCents > 0 ? merchantKey(tx) : ''
    if (key) newestByKey.set(key, tx)
  }
  return [...newestByKey.values()].flatMap((tx) => {
    const age = daysBetween(tx.date, today)
    if (age < RENEWAL_WINDOW.least || age > RENEWAL_WINDOW.most) return []
    const words = `${tx.name} ${tx.merchantName ?? ''}`
    if (tx.amountCents < RENEWAL_MIN_CENTS || !RENEWAL_WORDS.test(words)) return []
    const charge = shown(tx)
    if (!charge) return []
    let dueDate = addCadence(tx.date, 'year')
    while (dueDate < today) dueDate = addCadence(dueDate, 'year')
    return [
      {
        key: shownKey(charge.name),
        billId: null,
        name: charge.name,
        amountCents: tx.amountCents,
        cadence: 'year' as const,
        dueDate,
        basis: 'renewal' as const,
        ...(charge.modelLabel && { modelLabel: charge.modelLabel }),
      },
    ]
  })
}

/** Spending (money out) in each calendar month, as "YYYY-MM". */
function spendingByMonth(history: PastTransaction[]): Map<string, number> {
  const months = new Map<string, number>()
  for (const tx of history) {
    if (tx.amountCents <= 0) continue
    const month = tx.date.slice(0, 7)
    months.set(month, (months.get(month) ?? 0) + tx.amountCents)
  }
  return months
}

/** The next December 1st that is today or later. */
function nextDecember(today: IsoDate): IsoDate {
  const { year } = dateParts(today)
  const thisYear = makeDate(year, 12, 1)
  return thisYear >= today ? thisYear : makeDate(year + 1, 12, 1)
}

/**
 * The holidays: the last full December's spending against a usual month
 * (the middle of the other full months seen). Months at the edges of the
 * history are partial, so they are left out.
 */
export function holidayFund(history: PastTransaction[], today: IsoDate): FundSuggestion | null {
  const first = history[0]?.date
  if (!first) return null
  const firstMonth = first.slice(0, 7)
  const current = today.slice(0, 7)
  const full = [...spendingByMonth(history)].filter(
    ([month]) => month > firstMonth && month < current,
  )
  const december = full.filter(([month]) => month.endsWith('-12')).at(-1)
  const others = full.filter(([month]) => !month.endsWith('-12')).map(([, cents]) => cents)
  if (!december || others.length < USUAL_MONTHS) return null
  const usual = median(others)
  const extra = december[1] - usual
  if (extra < HOLIDAY_MIN_CENTS || extra < usual * HOLIDAY_MIN_SHARE) return null
  return {
    key: HOLIDAYS_KEY,
    billId: null,
    name: 'Holidays',
    amountCents: Math.ceil(extra / HOLIDAY_ROUND_CENTS) * HOLIDAY_ROUND_CENTS,
    cadence: 'year',
    dueDate: nextDecember(today),
    basis: 'holidays',
  }
}

/** Every suggestion, surest first, each cost once (by key), leaving out `settled` keys. */
export function fundSuggestions(
  all: (FundSuggestion | null)[],
  settled: ReadonlySet<string>,
): FundSuggestion[] {
  const seen = new Set<string>(settled)
  return all.filter((suggestion): suggestion is FundSuggestion => {
    if (!suggestion || seen.has(suggestion.key)) return false
    seen.add(suggestion.key)
    return true
  })
}
