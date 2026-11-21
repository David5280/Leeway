// Finding the yearly and irregular costs worth a sinking fund, from what
// Leeway already knows. Pure: the history, the bills and the repeating
// charges come in; suggestions come out, each with what it is based on.
//
// Four signs, surest first:
// - a bill the owner tracks that comes due yearly or quarterly;
// - a charge that repeats yearly or quarterly (an annual subscription);
// - one large charge about a year ago whose words say it renews (insurance,
//   a registration, a membership), not seen again since;
// - December spending well above a usual month: the holidays.

import { dateParts, daysBetween, makeDate, type IsoDate } from '../../lib/dates.js'
import { addCadence } from '../../lib/periods.js'
import type { Bill } from '../bills.js'
import { median } from '../pay/paychecks.js'
import { merchantKey, textKey } from '../merchantKey.js'
import type { PastTransaction, RecurringSeries } from '../recurring.js'
import type { FundCadence } from './math.js'

/** What a suggestion is based on, for the words beside it. */
export type FundBasis = 'bill' | 'repeating' | 'renewal' | 'holidays'

export interface FundSuggestion {
  /** Stable, so adding or dismissing it keeps it from coming back. */
  key: string
  name: string
  /** What it comes to each time. */
  amountCents: number
  cadence: FundCadence
  /** When it is next expected, today or later. */
  dueDate: IsoDate
  basis: FundBasis
  /** The last time it was paid, when history shows it. */
  lastDate: IsoDate | null
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

/** Suggested amounts are rounded up to this, so they read as a plan, not a receipt. */
const HOLIDAY_ROUND_CENTS = 5_000

const FUND_CADENCE_SET: ReadonlySet<string> = new Set(['quarter', 'year'])
const isFundCadence = (cadence: string): cadence is FundCadence => FUND_CADENCE_SET.has(cadence)

/** The cadence's next date after `last` that is today or later. */
function nextFrom(last: IsoDate, cadence: FundCadence, today: IsoDate): IsoDate {
  let next = addCadence(last, cadence)
  while (next < today) next = addCadence(next, cadence)
  return next
}

/** Bills the owner tracks that come due yearly or quarterly. */
export function billFunds(bills: Bill[]): FundSuggestion[] {
  return bills.flatMap((bill) => {
    if (!isFundCadence(bill.cadence)) return []
    return [
      {
        key: `bill:${bill.id}`,
        name: bill.name,
        amountCents: bill.amountCents,
        cadence: bill.cadence,
        dueDate: bill.nextDueDate,
        basis: 'bill' as const,
        lastDate: bill.lastPaidDate,
      },
    ]
  })
}

/**
 * The key a charge's suggestion is kept under: made from the name the app
 * shows, never the bank's text, so an assistant handed it learns nothing the
 * owner cannot see (as recurring.ts does for its suggestions).
 */
export const shownKey = (name: string) => `name:${textKey(name)}`

/** Charges repeating yearly or quarterly, not tracked as a bill yet. */
export function repeatingFunds(series: RecurringSeries[], today: IsoDate): FundSuggestion[] {
  return series.flatMap((found) => {
    if (found.direction !== 'out' || !isFundCadence(found.cadence)) return []
    return [
      {
        key: shownKey(found.name),
        name: found.name,
        amountCents: found.typicalAmountCents,
        cadence: found.cadence,
        dueDate: nextFrom(found.lastDate, found.cadence, today),
        basis: 'repeating' as const,
        lastDate: found.lastDate,
      },
    ]
  })
}

/**
 * One large charge about a year ago that reads like a renewal, from a
 * merchant not charged since: likely due again around the same day.
 * `name` gives a charge the name the app shows for it.
 */
export function renewalFunds(
  history: PastTransaction[],
  today: IsoDate,
  name: (tx: PastTransaction) => string,
): FundSuggestion[] {
  const newestByKey = new Map<string, PastTransaction>()
  for (const tx of history) {
    if (tx.amountCents <= 0) continue
    const key = merchantKey(tx)
    if (key) newestByKey.set(key, tx)
  }
  const found: FundSuggestion[] = []
  for (const tx of newestByKey.values()) {
    const age = daysBetween(tx.date, today)
    const words = `${tx.name} ${tx.merchantName ?? ''}`
    if (age < RENEWAL_WINDOW.least || age > RENEWAL_WINDOW.most) continue
    if (tx.amountCents < RENEWAL_MIN_CENTS || !RENEWAL_WORDS.test(words)) continue
    const shown = name(tx)
    found.push({
      key: shownKey(shown),
      name: shown,
      amountCents: tx.amountCents,
      cadence: 'year',
      dueDate: nextFrom(tx.date, 'year', today),
      basis: 'renewal',
      lastDate: tx.date,
    })
  }
  return found
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
  const months = spendingByMonth(history)
  const firstMonth = first.slice(0, 7)
  const current = today.slice(0, 7)
  const full = [...months.entries()].filter(([month]) => month > firstMonth && month < current)
  const december = full.filter(([month]) => month.endsWith('-12')).at(-1)
  const others = full.filter(([month]) => !month.endsWith('-12')).map(([, cents]) => cents)
  if (!december || others.length < USUAL_MONTHS) return null
  const usual = median(others)
  const extra = december[1] - usual
  if (extra < HOLIDAY_MIN_CENTS || extra < usual * HOLIDAY_MIN_SHARE) return null
  return {
    key: HOLIDAYS_KEY,
    name: 'Holidays',
    amountCents: Math.ceil(extra / HOLIDAY_ROUND_CENTS) * HOLIDAY_ROUND_CENTS,
    cadence: 'year',
    dueDate: nextDecember(today),
    basis: 'holidays',
    lastDate: null,
  }
}

/** Every suggestion, surest first, each cost once (by key), leaving out `settled` keys. */
export function fundSuggestions(
  signs: {
    bills: FundSuggestion[]
    repeating: FundSuggestion[]
    renewals: FundSuggestion[]
    holidays: FundSuggestion | null
  },
  settled: ReadonlySet<string>,
): FundSuggestion[] {
  const all = [
    ...signs.bills,
    ...signs.repeating,
    ...signs.renewals,
    ...(signs.holidays ? [signs.holidays] : []),
  ]
  const seen = new Set<string>(settled)
  return all.filter((suggestion) => {
    if (seen.has(suggestion.key)) return false
    seen.add(suggestion.key)
    return true
  })
}
