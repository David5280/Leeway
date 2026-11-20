// The cash on hand to payday, stepping down with each bill.

import { describe, expect, it } from 'vitest'
import type { CashFlow } from '../api/client'
import { cashPath, lowestPoint } from './cashPath'

const bill = (name: string, dueDate: string, amountCents: number, overdue = false) => ({
  billId: name,
  name,
  dueDate,
  amountCents,
  overdue,
})

const flow = (cashCents: number, billsDue: CashFlow['billsDue']): CashFlow => ({
  today: '2026-11-17',
  nextPayday: '2026-11-28',
  paydaySource: 'pay_period',
  expectedPayCents: null,
  daysUntilPayday: 11,
  cashCents,
  billsDue,
  billsDueCents: billsDue.reduce((sum, one) => sum + one.amountCents, 0),
  leftAfterBillsCents: cashCents,
  perDayCents: 0,
})

describe('cashPath', () => {
  it('stays flat until each bill, steps down on its day, and runs to payday', () => {
    const path = cashPath(
      flow(200000, [
        bill('Rent', '2026-11-20', 120000),
        bill('Phone', '2026-11-20', 5000),
        bill('Power', '2026-11-25', 8000),
      ]),
    )
    expect(path).toEqual([
      { date: '2026-11-17', cents: 200000, bills: [] },
      { date: '2026-11-19', cents: 200000, bills: [] },
      { date: '2026-11-20', cents: 75000, bills: ['Rent', 'Phone'] },
      { date: '2026-11-24', cents: 75000, bills: [] },
      { date: '2026-11-25', cents: 67000, bills: ['Power'] },
      { date: '2026-11-28', cents: 67000, bills: [] },
    ])
    expect(lowestPoint(path)).toEqual({ date: '2026-11-25', cents: 67000, bills: ['Power'] })
  })

  it('takes an overdue bill, or one due today, out today, and leaves out any after payday', () => {
    const path = cashPath(
      flow(50000, [
        bill('Gym', '2026-11-10', 4000, true),
        bill('Water', '2026-11-17', 1000),
        bill('Rent', '2026-11-18', 9000),
        bill('Later', '2026-12-02', 1000),
      ]),
    )
    expect(path).toEqual([
      { date: '2026-11-17', cents: 45000, bills: ['Gym', 'Water'] },
      { date: '2026-11-18', cents: 36000, bills: ['Rent'] },
      { date: '2026-11-28', cents: 36000, bills: [] },
    ])
  })

  it('is a flat line with no bills, and goes below zero when the bills do not fit', () => {
    expect(cashPath(flow(0, []))).toEqual([
      { date: '2026-11-17', cents: 0, bills: [] },
      { date: '2026-11-28', cents: 0, bills: [] },
    ])
    const short = cashPath(flow(-2000, [bill('Rent', '2026-11-28', 9e14)]))
    expect(short.at(-1)).toEqual({ date: '2026-11-28', cents: -2000 - 9e14, bills: ['Rent'] })
    expect(lowestPoint(short).cents).toBe(-2000 - 9e14)
  })
})
