// The paydays a payroll's cycle expects ahead (domain/pay/projection.ts):
// each one counted from the payroll's usual day and moved off a weekend or
// bank holiday on its own, so one moved payday never moves those after it.

import { describe, expect, it } from 'vitest'
import { paydaysThrough } from '../src/domain/pay/projection.js'
import type { IsoDate } from '../src/lib/dates.js'
import { payFrom, paying } from './fixtures/paychecks.js'

/** The main employer's paydays after `today` through `to`, read from paydays oldest first. */
function paydaysAhead(paydays: IsoDate[], today: IsoDate, to: IsoDate) {
  const { employer } = payFrom(paying(paydays), today)
  return { cadence: employer!.cadence, dates: paydaysThrough(employer!.projection, today, to) }
}

describe('the paydays ahead', () => {
  it('moves only the payday a holiday falls on: Thursdays stay Thursdays after Thanksgiving', () => {
    const thursdays = ['2026-09-03', '2026-09-17', '2026-10-01', '2026-10-15', '2026-10-29']
    const ahead = paydaysAhead([...thursdays, '2026-11-12'], '2026-11-20', '2026-12-31')
    // Thursday Nov 26 is Thanksgiving, paid the Wednesday before.
    expect(ahead).toEqual({ cadence: 'biweek', dates: ['2026-11-25', '2026-12-10', '2026-12-24'] })
  })

  it('keeps a weekly Monday payroll on Mondays around Monday holidays', () => {
    const mondays = ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14']
    const ahead = paydaysAhead(
      [...mondays, '2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11'],
      '2027-01-13',
      '2027-02-23',
    )
    // Martin Luther King Jr. Day (Jan 18) and Presidents Day (Feb 15) are
    // each paid the Friday before; the Mondays between them are not.
    expect(ahead).toEqual({
      cadence: 'week',
      dates: ['2027-01-15', '2027-01-25', '2027-02-01', '2027-02-08', '2027-02-12', '2027-02-22'],
    })
  })

  it('moves a twice-monthly payday off a weekend without moving the next', () => {
    const paydays = ['2026-06-15', '2026-06-30', '2026-07-15', '2026-07-31', '2026-08-14']
    const ahead = paydaysAhead(
      [...paydays, '2026-08-31', '2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30'],
      '2026-11-05',
      '2026-12-16',
    )
    // Sunday Nov 15 is paid Friday Nov 13; the 30th and the 15th after it stay put.
    expect(ahead).toEqual({
      cadence: 'semimonth',
      dates: ['2026-11-13', '2026-11-30', '2026-12-15'],
    })
  })

  it('pays a twice-monthly 1st and 15th payroll before New Year, then on the 15th', () => {
    // Weekend paydays paid the Friday before: Sat Aug 15, Sun Nov 1, Sun Nov 15.
    const paydays = ['2026-08-14', '2026-09-01', '2026-09-15', '2026-10-01', '2026-10-15']
    const ahead = paydaysAhead([...paydays, '2026-10-30', '2026-11-13'], '2026-11-20', '2027-01-31')
    // New Year's Day, a Friday, is paid Thursday Dec 31; Jan 15 stays put.
    expect(ahead).toEqual({
      cadence: 'semimonth',
      dates: ['2026-12-01', '2026-12-15', '2026-12-31', '2027-01-15'],
    })
  })

  it('keeps a weekly Friday payroll on Fridays after Christmas and New Year', () => {
    const fridays = ['2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13', '2026-11-20']
    const ahead = paydaysAhead(
      [...fridays, '2026-11-27', '2026-12-04', '2026-12-11'],
      '2026-12-12',
      '2027-01-15',
    )
    // Christmas and New Year's Day are Fridays, each paid the Thursday before.
    expect(ahead).toEqual({
      cadence: 'week',
      dates: ['2026-12-18', '2026-12-24', '2026-12-31', '2027-01-08', '2027-01-15'],
    })
  })

  it('moves a monthly payday off a weekend without moving the next', () => {
    const paydays = ['2026-06-15', '2026-07-15', '2026-08-14', '2026-09-15', '2026-10-15']
    const ahead = paydaysAhead(paydays, '2026-10-20', '2027-01-31')
    expect(ahead).toEqual({ cadence: 'month', dates: ['2026-11-13', '2026-12-15', '2027-01-15'] })
  })

  it('takes the later reading at each step while paydays fit two cadences', () => {
    // Three Fridays near the 15th and month end: every two weeks or twice a month.
    const ahead = paydaysAhead(
      ['2026-10-16', '2026-10-30', '2026-11-13'],
      '2026-11-19',
      '2027-01-20',
    )
    expect(ahead.cadence).toBe('biweek')
    // Each is the later of the two readings' next paydays, so none comes
    // sooner than it may: twice a month on the 1st and 16th wins, a closed
    // day moved to the business day after (Jan 1, then Sat Jan 16 and MLK Day).
    expect(ahead.dates).toEqual(['2026-12-01', '2026-12-16', '2027-01-04', '2027-01-19'])
  })

  it('has no paydays when the next comes after the window', () => {
    expect(paydaysAhead(['2026-10-15', '2026-11-13'], '2026-11-19', '2026-12-01').dates).toEqual([])
  })
})
