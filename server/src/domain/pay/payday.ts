// The next payday, and how sure it is. Pure.

import type { IsoDate } from '../../lib/dates.js'
import { periodContaining, type Cadence } from '../../lib/periods.js'
import { periodConfig, type Settings } from '../settings.js'
import type { CurrentPay } from './current.js'
import { PAY_CADENCE } from './period.js'

/** Where the payday came from, so the app and an agent can say how sure it is. */
export type PaydaySource = 'pay_period' | 'detected_income' | 'period_end'

export interface Payday {
  date: IsoDate
  source: PaydaySource
  /** A usual paycheck expected that day, when paychecks were found. */
  amountCents: number | null
  /** How often pay comes, when the pay period or the paychecks say. */
  cadence: Cadence | null
  /**
   * True while the main employer's cadence is unconfirmed (one paycheck, or
   * paydays that fit two cadences), so the date is the cautious projection.
   * A side job's guess never makes it one: the date is the main job's.
   */
  estimate: boolean
}

/**
 * The next payday. A paycheck budget period knows it exactly. Otherwise the
 * main employer's next paycheck says (see current.ts), or the owner's own
 * pay in its place (ownPay.ts), and with neither, the end of the budget
 * period stands in, which the app says.
 */
export function paydayFrom(pay: CurrentPay, settings: Settings, today: IsoDate): Payday {
  const config = periodConfig(settings)
  // `end` is exclusive: it is already the first day of the next period.
  const nextPeriodStart = periodContaining(today, config).end
  if (config.kind === 'paycheck') {
    return {
      date: nextPeriodStart,
      source: 'pay_period',
      amountCents: pay.paycheckCents,
      cadence: PAY_CADENCE[config.frequency],
      estimate: false,
    }
  }
  // The main job's payday, or the owner's own pay's, which may stand with no job found.
  if (pay.nextPayday) {
    return {
      date: pay.nextPayday,
      source: 'detected_income',
      // With two jobs, the main job's paycheck: the one that lands that day.
      amountCents: pay.nextPaycheckCents,
      cadence: pay.cadence,
      // Only the main job's own guess: pay.estimate also counts a side job's.
      estimate: pay.employer?.estimate ?? false,
    }
  }
  return {
    date: nextPeriodStart,
    source: 'period_end',
    amountCents: null,
    cadence: null,
    estimate: false,
  }
}
