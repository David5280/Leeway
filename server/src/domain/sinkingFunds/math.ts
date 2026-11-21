// A sinking fund's numbers: when its cost next comes due, and the steady
// share of it to put by each paycheck or budget period so it is there in
// time. Pure.
//
// The share is the cost spread evenly over its cycle (a $1,200 yearly bill
// is $100 a month, about $46 every two weeks), the way people budget for
// these costs: steady, whatever the date, so it never jumps the month
// before it lands.

import type { IsoDate } from '../../lib/dates.js'
import { convertCadence, type Cadence } from '../../lib/periods.js'
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
