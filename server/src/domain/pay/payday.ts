// The next payday, and how sure it is, and the paydays after it: one rule
// for every day, so the forecast's paydays ahead are each the very date
// get_pay and get_cash_flow will give on the day before it. Pure.

import type { IsoDate } from '../../lib/dates.js'
import { periodContaining, type Cadence } from '../../lib/periods.js'
import { periodConfig, type Settings } from '../settings.js'
import type { CurrentPay } from './current.js'
import { PAY_CADENCE, type PaycheckPeriod } from './period.js'
import { isOwnPeriod, nextOwnPayday, nextPeriodPayday } from './periodPayday.js'
import { paydayAfter } from './projection.js'

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
 * The next payday. A paycheck budget period knows it exactly: the next
 * payday on its schedule, paid the business day before a weekend or a bank
 * holiday by the same rule as the owner's own pay (periodPayday.ts); on the
 * schedule their pay sets, the payday they gave stands too, so the two
 * always agree. Otherwise the main employer's next paycheck says (see
 * current.ts), or the owner's own pay in its place (ownPay.ts), and with
 * neither, the end of the budget period stands in, which the app says.
 */
export function paydayFrom(pay: CurrentPay, settings: Settings, today: IsoDate): Payday {
  const config = periodConfig(settings)
  if (config.kind === 'paycheck') {
    return {
      date: periodPayday(config, settings, today),
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
    // `end` is exclusive: it is already the first day of the next period.
    date: periodContaining(today, config).end,
    source: 'period_end',
    amountCents: null,
    cadence: null,
    estimate: false,
  }
}

/** A paycheck budget period's next payday; on the schedule the owner's pay sets, the payday they gave stands too. */
function periodPayday(config: PaycheckPeriod, settings: Settings, day: IsoDate): IsoDate {
  const { override } = settings.pay
  return nextPeriodPayday(config, day, override && isOwnPeriod(config, override) ? override : null)
}

/**
 * The first payday after `day` by paydayFrom's rule, as it would read pay
 * then: a paycheck budget period's, else the owner's own pay's (whether it
 * stands in for a job or none, ownPay.ts), else the main job's, each counted
 * on from its schedule; null with none.
 */
function paydayAfterDay(pay: CurrentPay, settings: Settings, day: IsoDate): IsoDate | null {
  const config = periodConfig(settings)
  const { override } = settings.pay
  if (config.kind === 'paycheck') return periodPayday(config, settings, day)
  if (override) return nextOwnPayday(override, day)
  return pay.employer ? paydayAfter(pay.employer.projection, day) : null
}

/**
 * Every payday after `today` up to and including `to`: paydayFrom's date,
 * then each one after it by the same rule, so each is the date get_pay and
 * get_cash_flow will give on the day before it, moved off a weekend or
 * holiday on its own. None when pay is unknown and a budget period's end
 * stands in. `pay` is read with the owner's word laid over (source.ts).
 */
export function paydaysAhead(
  pay: CurrentPay,
  settings: Settings,
  today: IsoDate,
  to: IsoDate,
): IsoDate[] {
  const first = paydayFrom(pay, settings, today)
  if (first.source === 'period_end') return []
  const dates: IsoDate[] = []
  // Each payday is after the day it is counted from, so this always moves on.
  for (let next: IsoDate | null = first.date; next !== null && next <= to;) {
    dates.push(next)
    next = paydayAfterDay(pay, settings, next)
  }
  return dates
}
