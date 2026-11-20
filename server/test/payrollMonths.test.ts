// When each payroll deduction counts toward a month's savings rate: from when
// it began, from a recent paystub only, and in part for the running month.

import { describe, expect, it } from 'vitest'
import type { MonthTotals } from '../src/domain/monthlyTotals.js'
import { EMPTY_PLAN, type Pension, type PensionPlan } from '../src/domain/retirement/pensions.js'
import {
  freshPaystub,
  monthPayroll,
  payrollStreams,
  paystubDate,
  pensionStart,
  runningPayShare,
  streamKinds,
} from '../src/domain/savings/payrollMonths.js'
import { confirmedPaystub } from './fixtures/paystub.js'

const TODAY = '2026-11-17'

const saved = (payDate: string | null, savedAt = '2026-11-14T18:00:00.000Z') => ({
  ...confirmedPaystub({ payDate }),
  savedAt,
})

const pension = (plan: Partial<PensionPlan>): Pension => ({
  accountId: 'pension',
  name: 'Colorado PERA',
  balanceCents: null,
  plan: {
    ...EMPTY_PLAN,
    contribution: { kind: 'amount', cents: 30000 },
    payCadence: 'month',
    ...plan,
  },
})

const month = (start: string, end: string, incomeCents: number, current = false): MonthTotals => ({
  start,
  end,
  current,
  incomeCents,
  spentCents: 0,
  categories: [],
})

describe('a paystub’s date and freshness', () => {
  it('goes by the pay date, or the day it was saved when it shows none', () => {
    expect(paystubDate(saved('2026-11-13'))).toBe('2026-11-13')
    expect(paystubDate(saved(null, '2026-10-02T23:00:00.000Z'))).toBe('2026-10-02')
  })

  it('counts a paystub from about the last six months, and no older', () => {
    expect(freshPaystub(saved('2026-05-18'), TODAY)).not.toBeNull()
    expect(freshPaystub(saved('2026-05-17'), TODAY)).toBeNull()
    expect(freshPaystub(null, TODAY)).toBeNull()
  })
})

describe('when a pension began', () => {
  it('counts the years of service back from when they were last checked', () => {
    expect(pensionStart({ ...EMPTY_PLAN, serviceYears: 4, checkedOn: '2026-06-01' }, TODAY)).toBe(
      '2022-06-01',
    )
    // Not checked yet, so the years run back from today.
    expect(pensionStart({ ...EMPTY_PLAN, serviceYears: 0.5 }, TODAY)).toBe('2026-05-18')
    expect(pensionStart(EMPTY_PLAN, TODAY)).toBeNull()
  })
})

describe('payrollStreams', () => {
  it('lists each pension with a contribution, and the plan a recent paystub shows', () => {
    const streams = payrollStreams(
      [pension({ serviceYears: 1, checkedOn: '2026-11-01' }), pension({ contribution: null })],
      null,
      saved('2026-11-13'),
      TODAY,
    )
    expect(streams).toEqual([
      { kind: 'pension', monthlyCents: 30000, since: '2025-11-01' },
      { kind: 'plan', monthlyCents: 40000, since: '2026-11-13' },
    ])
    expect(streamKinds(streams)).toEqual({ pension: true, plan: true })
  })

  it('leaves out a paystub too old to say what pay takes now', () => {
    const streams = payrollStreams([], null, saved('2026-03-13'), TODAY)
    expect(streams).toEqual([])
    expect(streamKinds(streams)).toEqual({ pension: false, plan: false })
  })
})

describe('runningPayShare', () => {
  const october = month('2026-10-01', '2026-10-31', 400000)

  it('is the running month’s pay so far over a usual finished month’s', () => {
    const running = month('2026-11-01', '2026-11-30', 100000, true)
    // An empty month is a gap, not a month of no pay.
    const empty = month('2026-09-01', '2026-09-30', 0)
    expect(runningPayShare([empty, october, running])).toBe(0.25)
  })

  it('never counts more than a whole month, and none without pay to go by', () => {
    expect(runningPayShare([october, month('2026-11-01', '2026-11-30', 900000, true)])).toBe(1)
    expect(runningPayShare([october, month('2026-11-01', '2026-11-30', 0, true)])).toBe(0)
    expect(runningPayShare([month('2026-11-01', '2026-11-30', 5000, true)])).toBe(0)
    expect(runningPayShare([october])).toBe(0)
  })
})

describe('monthPayroll', () => {
  const streams = [
    { kind: 'pension' as const, monthlyCents: 30000, since: null },
    { kind: 'plan' as const, monthlyCents: 40001, since: '2026-11-13' },
  ]

  it('counts each deduction from the month it began', () => {
    expect(monthPayroll(streams, month('2026-10-01', '2026-10-31', 1), 1)).toEqual({
      pensionCents: 30000,
      planCents: null,
    })
    expect(monthPayroll(streams, month('2026-11-01', '2026-11-30', 1), 1)).toEqual({
      pensionCents: 30000,
      planCents: 40001,
    })
  })

  it('counts the running month in proportion, and nothing at a share of zero', () => {
    const running = month('2026-11-01', '2026-11-30', 1, true)
    expect(monthPayroll(streams, running, 0.5)).toEqual({ pensionCents: 15000, planCents: 20001 })
    expect(monthPayroll(streams, running, 0)).toEqual({ pensionCents: null, planCents: null })
  })
})
