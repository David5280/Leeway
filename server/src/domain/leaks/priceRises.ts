// Price rises on repeating charges that no bill tracks yet (a tracked bill's
// change is a bill_change alert, billChanges.ts, so it is never said twice).
// Pure: each repeating charge's history comes in, the rises worth a look come
// out; leakSource.ts reads them.
//
// A rise is only news when the price was steady before it: the two charges
// before the latest agree, and the latest is clearly more than both. A bill
// whose amount moves every month, like power, never had a steady price to
// rise from, so it stays quiet. The latest charge must be the first at the
// new price, so the same rise is never news twice.

import { daysBetween, type IsoDate } from '../../lib/dates.js'
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

/** What a repeating charge's latest charge says about its price, or null when nothing. */
export function priceRiseOf(repeating: RepeatingCharge, today: IsoDate): PriceRise | null {
  const days = byDay(repeating.charges)
  if (days.length < 3) return null
  const [older, before, latest] = days.slice(-3) as [ChargeLine, ChargeLine, ChargeLine]
  if (daysBetween(latest.date, today) > RISE_NEWS_DAYS) return null
  if (!steady(older.amountCents, before.amountCents)) return null
  if (!isPriceRise(before.amountCents, latest.amountCents)) return null
  return { name: repeating.name, charge: latest, previousCents: before.amountCents }
}

/** Every price rise among these repeating charges, newest first. */
export function findPriceRises(repeating: RepeatingCharge[], today: IsoDate): PriceRise[] {
  return repeating
    .map((one) => priceRiseOf(one, today))
    .filter((rise) => rise !== null)
    .sort((a, b) => b.charge.date.localeCompare(a.charge.date))
}
