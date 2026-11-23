// Paydays as a payroll really pays them, for tests of how often pay comes:
// two weeks apart, or on two days of the month, each moved to the business
// day before (or, for some payrolls, after) when banks are closed. The
// holidays are the US bank holidays the app itself knows (pay/holidays.ts).

import { addDays, clampedDate, type IsoDate } from '../../src/lib/dates.js'
import { businessDayOnOrAfter, businessDayOnOrBefore } from '../../src/domain/pay/businessDays.js'
import type { SemimonthSchedule } from '../../src/domain/pay/semimonthly.js'

/** The date, or the business day before it when banks are closed. */
export const paidOnBusinessDay = businessDayOnOrBefore

/** The date, or the business day after it when banks are closed: how some payrolls pay. */
export const paidOnBusinessDayAfter = businessDayOnOrAfter

/** `count` biweekly paydays from `start`, each holiday one paid the business day before. */
export function biweeklyPaid(start: IsoDate, count: number): IsoDate[] {
  return Array.from({ length: count }, (_, i) => paidOnBusinessDay(addDays(start, 14 * i)))
}

/**
 * `count` paydays on a schedule, from its first day in `month` of `year`
 * (or its second, from `half` 1), each moved by `pay`.
 */
export function semimonthlyPaid(
  schedule: SemimonthSchedule,
  [year, month, half]: [number, number, 0 | 1],
  count: number,
  pay: (date: IsoDate) => IsoDate = paidOnBusinessDay,
): IsoDate[] {
  return Array.from({ length: count }, (_, i) => {
    const nth = half + i
    const day = nth % 2 === 0 ? schedule.first : schedule.second
    return pay(clampedDate(year, month + Math.floor(nth / 2), day))
  })
}
