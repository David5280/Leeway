// Price rises on repeating charges that no bill tracks yet (a tracked bill's
// change is a bill_change alert, billChanges.ts, so it is never said twice).
// Pure: each repeating charge's history comes in, the rises worth a look come
// out; leakSource.ts reads them.
//
// A rise is only news when the price was steady before it and the latest
// charge is the next one in the cycle:
// - the latest comes a cycle after an earlier charge. A charge in between is
//   an extra off the cycle (an annual fee at a monthly gym, say) and is
//   skipped, and an extra that is itself the latest has no charge a cycle
//   before it, so an extra is never read as the new price;
// - the two charges before it agree, an odd one between steady ones aside,
//   and the latest is clearly more than the last of them;
// - the earlier charges do not move from cycle to cycle. A bill like power,
//   whose amount moves every month, never had a steady price to rise from, so
//   it stays quiet. Bill changes judge this the same way (amountsVary).
// The latest charge must be the first at the new price, so the same rise is
// never news twice.

import { daysBetween, type IsoDate } from '../../lib/dates.js'
import { addCadence, type Cadence } from '../../lib/periods.js'
import { amountsVary, CHARGES_READ, withoutOneOff } from '../billChanges.js'
import { fitsCadence } from '../recurring.js'
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

/** A repeating charge no bill tracks, as the rise check reads it. */
export interface RepeatingCharge {
  /** The merchant as the app shows it, with no account number. */
  name: string
  /** How often it repeats, as detection found it. */
  cadence: Cadence
  /** Its posted charges, oldest first. */
  charges: ChargeLine[]
}

export interface PriceRise {
  name: string
  /** The latest charge, the first at the new price, totalled with any other that day. */
  charge: ChargeLine
  /** What it cost before. */
  previousCents: number
}

/** One line per day, oldest first, a day's charges added up: a split payment counts once. */
function byDay(charges: ChargeLine[]): ChargeLine[] {
  const days = new Map<IsoDate, ChargeLine>()
  for (const charge of charges) {
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
 * when no day sits a cycle before the latest, as when the latest is itself an
 * extra or a cycle was missed.
 */
function cycleBefore(earlier: ChargeLine[], latest: ChargeLine, cadence: Cadence) {
  const fitting = earlier.filter((day) => fitsCadence(daysBetween(day.date, latest.date), cadence))
  if (fitting.length === 0) return null
  // Bands have a few days' slack, so an extra just after a charge can fit too:
  // the cycle before is the day the latest follows most closely by the calendar.
  const offBy = (day: ChargeLine) =>
    Math.abs(daysBetween(addCadence(day.date, cadence), latest.date))
  const previous = fitting.reduce((best, day) => (offBy(day) <= offBy(best) ? day : best))
  return earlier.slice(0, earlier.indexOf(previous) + 1).reverse()
}

/** What a repeating charge's latest charge says about its price, or null when nothing. */
export function priceRiseOf(repeating: RepeatingCharge, today: IsoDate): PriceRise | null {
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
  return { name: repeating.name, charge: latest, previousCents: before }
}

/** Every price rise among these repeating charges, newest first. */
export function findPriceRises(repeating: RepeatingCharge[], today: IsoDate): PriceRise[] {
  return repeating
    .map((one) => priceRiseOf(one, today))
    .filter((rise) => rise !== null)
    .sort((a, b) => b.charge.date.localeCompare(a.charge.date))
}
