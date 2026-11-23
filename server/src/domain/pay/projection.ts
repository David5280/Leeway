// The paydays a payroll's cycle expects from here on: the next one, and the
// run of them after it for the weeks ahead. Pure.
//
// Each payday is counted from the payroll's usual day and moved off a
// weekend or bank holiday on its own (cadence.ts). Stepping a cadence on
// from a payday a holiday already moved would carry that move into every
// payday after it: a Thursday payroll's Thanksgiving payday, paid the
// Wednesday before, would make every later one a Wednesday.

import type { IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { laterNextPayday, nextPaydayAfter } from './cadence.js'
import type { EmployerRun } from './paychecks.js'
import type { SemimonthSchedule } from './semimonthly.js'

/** What a payroll's paydays to come are projected from. */
export interface PayProjection {
  /** The paydays on its cycle so far, oldest first. */
  paydays: IsoDate[]
  cadence: Cadence
  /** For twice a month, the two days of the month it pays on (or may, when ambiguous). */
  schedule: SemimonthSchedule | null
  /** True while the paydays fit every two weeks and twice a month alike. */
  ambiguous: boolean
}

/** The projection for a run. A bonus between paydays says nothing of when the next comes (offCycle.ts). */
export function projectionOf(run: EmployerRun): PayProjection {
  return {
    paydays: run.cycle.map((paycheck) => paycheck.date),
    cadence: run.cadence,
    schedule: run.schedule,
    ambiguous: run.ambiguous,
  }
}

/**
 * The first payday after `after`. Paydays that fit every two weeks and twice
 * a month alike take the later of the two, so none is promised before it may come.
 */
export function paydayAfter(projection: PayProjection, after: IsoDate): IsoDate {
  const { paydays, cadence, schedule, ambiguous } = projection
  if (ambiguous) return laterNextPayday(paydays, after, schedule!)
  return nextPaydayAfter(paydays, cadence, after, schedule ?? undefined)
}

/** Every payday after `after` up to and including `to`, each moved on its own. */
export function paydaysThrough(projection: PayProjection, after: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = []
  let next = paydayAfter(projection, after)
  while (next <= to) {
    dates.push(next)
    next = paydayAfter(projection, next)
  }
  return dates
}
