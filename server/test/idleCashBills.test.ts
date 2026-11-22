// What counts as a bill payment when typical spending is averaged for cash
// that could earn more (idleCashBills.ts): only payments that fit a bill's
// amount, no more of them than it falls due, and never more than it costs,
// so a short pattern never takes everyday shopping out of the average.

import { describe, expect, it } from 'vitest'
import {
  billPaidByRange,
  type PatternBill,
  type PatternPayment,
} from '../src/domain/idleCashBills.js'

/** August, September and October 2026. */
const MONTHS = [
  { start: '2026-08-01', end: '2026-09-01' },
  { start: '2026-09-01', end: '2026-10-01' },
  { start: '2026-10-01', end: '2026-11-01' },
]

/** Rent: $1,500 due on the 1st of every month. */
const rent: PatternBill = {
  id: 'rent',
  amountCents: 150_000,
  cadence: 'month',
  anchorDate: '2026-12-01',
  amountVaries: false,
}

let paymentCount = 0
const payment = (billId: string, date: string, amountCents: number): PatternPayment => {
  paymentCount += 1
  return { id: `t${paymentCount}`, billId, date, amountCents }
}

describe('billPaidByRange', () => {
  it('takes a bill paid at its amount out of each month it was paid', () => {
    const paid = ['2026-08-01', '2026-09-01', '2026-10-01'].map((date) =>
      payment('rent', date, 150_000),
    )
    expect(billPaidByRange(MONTHS, [rent], paid)).toEqual([150_000, 150_000, 150_000])
  })

  it('never takes shopping that only shares a short pattern with a bill', () => {
    // A $65 yearly membership matched by "costco", over $725 Costco trips.
    const membership = { ...rent, id: 'costco', amountCents: 6_500, cadence: 'year' as const }
    const trips = ['2026-08-04', '2026-08-18', '2026-09-15', '2026-10-06'].map((date) =>
      payment('costco', date, 72_500),
    )
    expect(billPaidByRange(MONTHS, [{ ...membership, anchorDate: '2026-09-15' }], trips)).toEqual([
      0, 0, 0,
    ])
    // The membership itself, paid the month it falls due, still comes out.
    const fee = payment('costco', '2026-09-15', 6_500)
    expect(
      billPaidByRange(MONTHS, [{ ...membership, anchorDate: '2026-09-15' }], [...trips, fee]),
    ).toEqual([0, 6_500, 0])
  })

  it('takes no more payments than a bill falls due in the month, closest to its amount first', () => {
    const paid = [
      payment('rent', '2026-08-01', 150_000),
      payment('rent', '2026-08-02', 149_000),
      payment('rent', '2026-08-20', 151_000),
    ]
    expect(billPaidByRange(MONTHS, [rent], paid)).toEqual([150_000, 0, 0])
  })

  it('takes nothing in a month the bill does not fall due', () => {
    const quarterly = { ...rent, cadence: 'quarter' as const, anchorDate: '2026-09-01' }
    const paid = MONTHS.map((month) => payment('rent', month.start, 150_000))
    expect(billPaidByRange(MONTHS, [quarterly], paid)).toEqual([0, 150_000, 0])
  })

  it('caps a bill paid a little above its amount at that amount, and leaves one far above', () => {
    const paid = [
      // $60 more is within what a bill change allows: it counts, up to $1,500.
      payment('rent', '2026-08-01', 156_000),
      // $300 more is a different charge, so it stays in spending.
      payment('rent', '2026-09-01', 180_000),
    ]
    expect(billPaidByRange(MONTHS, [rent], paid)).toEqual([150_000, 0, 0])
  })

  it('takes any payment of a varying bill, never more than its amount a due date', () => {
    const power = { ...rent, id: 'power', amountCents: 12_000, amountVaries: true }
    const paid = [
      payment('power', '2026-08-03', 9_500),
      payment('power', '2026-09-03', 14_000),
      payment('power', '2026-10-03', 30_000),
      payment('power', '2026-10-20', 30_000),
    ]
    expect(billPaidByRange(MONTHS, [power], paid)).toEqual([9_500, 12_000, 12_000])
  })

  it('lets each payment count toward one bill only', () => {
    // One charge whose text holds two bills' patterns.
    const twin = { ...rent, id: 'twin' }
    const both = [payment('rent', '2026-08-01', 150_000), payment('twin', '2026-08-01', 150_000)]
    both[1]!.id = both[0]!.id
    expect(billPaidByRange(MONTHS, [rent, twin], both)).toEqual([150_000, 0, 0])
  })
})
