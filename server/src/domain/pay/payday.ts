// The next payday, and how sure it is. Pure.

import type { IsoDate } from '../../lib/dates.js'
import { periodContaining, type Cadence } from '../../lib/periods.js'
import { periodConfig, type Settings } from '../settings.js'
import type { CurrentPay } from './current.js'

/** Where the payday came from, so the app and an agent can say how sure it is. */
export type PaydaySource = 'pay_period' | 'detected_income' | 'period_end'

export interface Payday {
  date: IsoDate
  source: PaydaySource
  /** A usual paycheck expected that day, when paychecks were found. */
  amountCents: number | null
  /** How often pay comes, when the pay period or the paychecks say. */
  cadence: Cadence | null
  /** True while one paycheck is all there is, so the date is a projection. */
  estimate: boolean
}

/** A paycheck budget period's frequency, as a cadence. */
export const PAY_CADENCE: Record<'weekly' | 'biweekly' | 'semimonthly' | 'monthly', Cadence> = {
  weekly: 'week',
  biweekly: 'biweek',
  semimonthly: 'semimonth',
  monthly: 'month',
}

/**
 * The next payday. A paycheck budget period knows it exactly. Otherwise the
 * soonest paycheck from an employer paying now says (see current.ts), and with no employer
 * paying, the end of the budget period stands in, which the app says.
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
  if (pay.nextPayday) {
    return {
      date: pay.nextPayday,
      source: 'detected_income',
      // With two jobs, the paycheck that lands on that day.
      amountCents: pay.nextPaycheckCents,
      cadence: pay.cadence,
      estimate: pay.estimate,
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
