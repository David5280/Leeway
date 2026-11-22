// Price rises on repeating charges that no bill tracks yet (a tracked bill's
// change is a bill_change alert, billChanges.ts, so it is never said twice).
// Pure: each repeating charge's history comes in, the rises worth a look come
// out; leakSource.ts reads them, only for charges a merchant made
// (merchantCharges.ts), and only on the cadences in RISE_CADENCES.
//
// A rise is only news when the price was steady before it and the latest
// charge is the next one in the cycle:
// - the latest comes a cycle after an earlier charge. A charge in between is
//   an extra off the cycle (an annual fee at a monthly gym, say) and is
//   skipped, and an extra that is itself the latest has no charge a cycle
//   before it, or follows the charge due that cycle, so an extra is never
//   read as the new price;
// - the two charges before it agree, an odd one between steady ones aside,
//   and the latest is clearly more than the last of them;
// - the earlier charges do not move from cycle to cycle. A bill like power,
//   whose amount moves every month, never had a steady price to rise from, so
//   it stays quiet. Bill changes judge this the same way (amountsVary).
// The latest charge must be the first at the new price, so the same rise is
// never news twice. So a rise right after a skipped cycle is never told:
// nothing sits a cycle before it, and the charge after it is no longer the
// first at the new price. Missing one beats telling a false one.
//
// The web app bundles this file for PRICE_RISE, so it imports only pure
// modules, never one that reaches the database (webBundle.test.ts).

import { daysBetween, type IsoDate } from '../../lib/dates.js'
import { addCadence, type Cadence } from '../../lib/periods.js'
import { amountsVary, CHARGES_READ, withoutOneOff } from '../billChanges.js'
import { fitsCadence } from '../cadenceBands.js'
import type { ChargeLine } from './duplicates.js'

/**
 * How far over the old price a charge must be to count as a rise: at least
 * this share and this many cents, so a few cents of tax stay quiet while a
 * $1 rise on a $10 plan shows.
 */
export const PRICE_RISE = { share: 0.05, cents: 100 } as const

/** Two charges within this share of each other count as the same, steady price. */
const STEADY_SHARE = 0.02

/** How long a rise stays news: past a monthly cycle, so it is seen before the next charge. */
export const RISE_NEWS_DAYS = 45

/**
 * The cadences a rise is looked for on: quarterly or more often. A rise needs
 * two steady charges before the latest, so three in all, and the history the
 * recurring finder reads (about 400 days) holds only two of a yearly charge.
 * Saying so here keeps the words on the Alerts page and in list_alerts true.
 */
export const RISE_CADENCES: readonly Cadence[] = ['week', 'biweek', 'semimonth', 'month', 'quarter']

/** A repeating charge no bill tracks, as the rise check reads it. */
export interface RepeatingCharge {
  /** How often it repeats, as detection found it. */
  cadence: Cadence
  /** Its posted charges, oldest first. */
  charges: ChargeLine[]
}

/** A price rise, with no name: leakSource.ts picks the name an alert may show (leakNames.ts). */
export interface PriceRise {
  /** The latest charge, the first at the new price, totalled with any other that day. */
  charge: ChargeLine
  /** What it cost before. */
  previousCents: number
}

/**
 * Whether a charge repeats one already kept for its day: the same amount, on
 * the same account and day. That is one charge made twice, which "Charged
 * twice?" tells (duplicates.ts), never a new price.
 */
const repeatsOneOf = (kept: ChargeLine[], charge: ChargeLine) =>
  kept.some(
    (one) =>
      one.date === charge.date &&
      one.accountId === charge.accountId &&
      one.amountCents === charge.amountCents,
  )

/**
 * One line per day, oldest first, a day's charges added up: a payment split
 * in parts counts once, at its whole amount. A charge repeated on its day
 * (repeatsOneOf) is left out first, so a double charge never reads as the
 * price doubling. A payment split in equal parts is read as one part each
 * cycle, which still compares like with like.
 */
function byDay(charges: ChargeLine[]): ChargeLine[] {
  const kept: ChargeLine[] = []
  for (const charge of charges) if (!repeatsOneOf(kept, charge)) kept.push(charge)
  const days = new Map<IsoDate, ChargeLine>()
  for (const charge of kept) {
    const seen = days.get(charge.date)
    // The day's last charge stands for the day, carrying the day's total.
    days.set(charge.date, { ...charge, amountCents: (seen?.amountCents ?? 0) + charge.amountCents })
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Whether two amounts are the same price, give or take STEADY_SHARE. */
const steady = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * STEADY_SHARE

/** Whether `amountCents` is a clear rise over `previousCents` (PRICE_RISE). */
export function isPriceRise(previousCents: number, amountCents: number): boolean {
  const rise = amountCents - previousCents
  return rise >= PRICE_RISE.cents && rise >= previousCents * PRICE_RISE.share
}

/**
 * The days before `latest` (oldest first), newest first, from the one a cycle
 * before it on: the days between are extras off the cycle, left out. Null
 * when no day sits a cycle before the latest, as when a cycle was missed, or
 * when the latest is itself an extra.
 *
 * Bands have a few days' slack, so an extra a few days after a charge can sit
 * a cycle after the charge before that one too (a $30 gym on the 1st with a
 * $50 fee on Nov 2 or 3). The charge due that cycle is then the one between
 * that lands closer to the due day, and the latest is the extra.
 *
 * An extra a few days before the next charge is due reads as that cycle's
 * charge until the real one posts, then clears: the real one lands on the due
 * day and the extra between is skipped.
 */
function cycleBefore(earlier: ChargeLine[], latest: ChargeLine, cadence: Cadence) {
  const fitting = earlier.filter((day) => fitsCadence(daysBetween(day.date, latest.date), cadence))
  if (fitting.length === 0) return null
  // The cycle before is the day the latest follows most closely by the calendar.
  const offBy = (day: ChargeLine, due: IsoDate) => Math.abs(daysBetween(due, day.date))
  const dueAfter = (day: ChargeLine) => addCadence(day.date, cadence)
  const previous = fitting.reduce((best, day) =>
    offBy(latest, dueAfter(day)) <= offBy(latest, dueAfter(best)) ? day : best,
  )
  const due = dueAfter(previous)
  const between = earlier.slice(earlier.indexOf(previous) + 1)
  if (between.some((day) => offBy(day, due) < offBy(latest, due))) return null
  return earlier.slice(0, earlier.indexOf(previous) + 1).reverse()
}

/** What a repeating charge's latest charge says about its price, or null when nothing. */
export function priceRiseOf(repeating: RepeatingCharge, today: IsoDate): PriceRise | null {
  if (!RISE_CADENCES.includes(repeating.cadence)) return null
  // The last few cycles, as bill changes read them: older history says nothing of today's price.
  const days = byDay(repeating.charges).slice(-CHARGES_READ)
  const latest = days.at(-1)
  if (!latest || daysBetween(latest.date, today) > RISE_NEWS_DAYS) return null
  const earlier = cycleBefore(days.slice(0, -1), latest, repeating.cadence)
  if (!earlier) return null
  const amounts = earlier.map((day) => day.amountCents)
  const [before, older] = withoutOneOff(amounts)
  if (before === undefined || older === undefined) return null
  if (!steady(older, before) || amountsVary(amounts)) return null
  if (!isPriceRise(before, latest.amountCents)) return null
  return { charge: latest, previousCents: before }
}

/** Every price rise among these repeating charges, newest first. */
export function findPriceRises(repeating: RepeatingCharge[], today: IsoDate): PriceRise[] {
  return repeating
    .map((one) => priceRiseOf(one, today))
    .filter((rise) => rise !== null)
    .sort((a, b) => b.charge.date.localeCompare(a.charge.date))
}
