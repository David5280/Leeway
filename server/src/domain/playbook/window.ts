// Which days the last pay period ran, so it can be closed out: from the
// paycheck before the latest one up to the day before the latest. Pure.
//
// A paycheck budget period already runs payday to payday, so with one the
// last pay period is simply the previous budget period. Otherwise the
// paychecks say; with only one, or only the owner's own pay, one cycle
// before the latest payday stands in. With no pay at all, the previous
// budget period is the last stretch there is to close out.

import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import {
  addCadence,
  cadenceOf,
  periodContaining,
  shiftPeriod,
  type Cadence,
  type PeriodConfig,
} from '../../lib/periods.js'
import type { Window } from './closeOut.js'

/** Days after a paycheck lands that the playbook greets it as new. */
export const JUST_PAID_DAYS = 3

/** About a cycle back from a payday: twice a month steps back half a month. */
export function cycleBefore(payday: IsoDate, cadence: Cadence): IsoDate {
  return cadence === 'semimonth' ? addDays(payday, -15) : addCadence(payday, cadence, -1)
}

/** What is known about pay, as the window needs it. */
export interface PayDates {
  cadence: Cadence | null
  /** Paydays seen from the main employer, oldest first. */
  paydays: IsoDate[]
  /** The next payday, from the paychecks or the owner's own pay. */
  nextPayday: IsoDate | null
}

/** The last pay period, and whether it matches a budget period exactly (`per`, its cadence). */
export interface LastPeriod {
  window: Window
  per: Cadence | null
}

/** The previous budget period, as a window. */
function previousBudgetPeriod(today: IsoDate, config: PeriodConfig): LastPeriod {
  const previous = shiftPeriod(periodContaining(today, config), -1, config)
  return { window: { start: previous.start, end: previous.end }, per: cadenceOf(config) }
}

/** The last payday on or before today: the newest paycheck seen, else a cycle before the next. */
function latestPayday(pay: PayDates, today: IsoDate): IsoDate | null {
  const seen = pay.paydays.filter((day) => day <= today).at(-1)
  if (seen) return seen
  return pay.nextPayday && pay.cadence ? cycleBefore(pay.nextPayday, pay.cadence) : null
}

/** The last pay period to close out. */
export function lastPayPeriod(pay: PayDates, today: IsoDate, config: PeriodConfig): LastPeriod {
  if (config.kind === 'paycheck' || !pay.cadence) return previousBudgetPeriod(today, config)
  const latest = latestPayday(pay, today)
  if (!latest) return previousBudgetPeriod(today, config)
  const before = pay.paydays.filter((day) => day < latest).at(-1)
  return { window: { start: before ?? cycleBefore(latest, pay.cadence), end: latest }, per: null }
}

/** Whether a paycheck landed in the last JUST_PAID_DAYS days, so the playbook greets it. */
export function justPaid(lastPaycheck: IsoDate | null, today: IsoDate): boolean {
  if (!lastPaycheck) return false
  const age = daysBetween(lastPaycheck, today)
  return age >= 0 && age < JUST_PAID_DAYS
}
