// A sinking fund's numbers: when its cost next comes due, and the steady
// share of it to put by each paycheck or budget period so it is there in
// time. Pure.
//
// The share is the cost spread evenly over its cycle (a $1,200 yearly bill
// is $100 a month, about $46 every two weeks), the way people budget for
// these costs: steady, whatever the date, so it never jumps the month
// before it lands. A cost added close to its due date has had too few
// shares by then, so shortAtDue says how much more it needs.

import { daysBetween, type IsoDate } from '../../lib/dates.js'
import { convertCadence, DAYS_PER_YEAR, PER_YEAR, type Cadence } from '../../lib/periods.js'
import { nextOnOrAfter } from '../../lib/schedule.js'

/** How often a fund's cost comes due. */
export const FUND_CADENCES = ['quarter', 'year'] as const

export type FundCadence = (typeof FUND_CADENCES)[number]

/** A cost due every `cadence` from `anchorDate`. */
export interface FundCost {
  amountCents: number
  cadence: FundCadence
  anchorDate: IsoDate
}

/** The next day the cost comes due, today or later. */
export function nextDue(cost: Pick<FundCost, 'cadence' | 'anchorDate'>, today: IsoDate): IsoDate {
  return nextOnOrAfter(cost.anchorDate, cost.cadence, today)
}

/** The steady share of the cost for one `per` (a paycheck's cadence, or a budget period's), rounded up a cent. */
export function shareOf(cost: Pick<FundCost, 'amountCents' | 'cadence'>, per: Cadence): number {
  // Rounding up keeps a year of shares from falling a few cents short of the bill.
  const exact = convertCadence(cost.amountCents * 100, cost.cadence, per) / 100
  return Math.ceil(exact)
}

/**
 * How far the steady share falls short of the cost when it comes due:
 * one share is held back each budget period on `period` from `startedOn`,
 * the current period counting in full, until `dueDate`. A fund added a
 * year ahead is short nothing; one added two weeks before its bill has had
 * about one share.
 */
export function shortAtDue(
  cost: Pick<FundCost, 'amountCents'>,
  perPeriodCents: number,
  period: Cadence,
  span: { startedOn: IsoDate; dueDate: IsoDate },
): number {
  const years = daysBetween(span.startedOn, span.dueDate) / DAYS_PER_YEAR
  const periods = Math.max(1, Math.ceil(years * PER_YEAR[period]))
  return Math.max(0, cost.amountCents - periods * perPeriodCents)
}
