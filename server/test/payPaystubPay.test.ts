// A confirmed paystub's take-home laid over the paychecks found
// (pay/paystubPay.ts): it sets its job's paycheck while it fits that job,
// the bank's deposits keep the paydays, and the owner's own pay still wins.
// Pure.

import { describe, expect, it } from 'vitest'
import type { PaystubPay } from '../src/domain/paystubs/applied.js'
import { currentPay } from '../src/domain/pay/current.js'
import { NO_PAY_SETTINGS, withOwnersPay } from '../src/domain/pay/ownPay.js'
import { withPaystubPay } from '../src/domain/pay/paystubPay.js'
import { PER_YEAR } from '../src/lib/periods.js'
import { everyDays, paycheck } from './fixtures/pay.js'

const TODAY = '2026-11-17'

/** Biweekly paydays from 4 September to 13 November. */
const PAYDAYS = everyDays('2026-09-04', 14, 6)

/** Acme paying 2,000.00 every two weeks, its newest paycheck on 13 November. */
const acmePay = () =>
  currentPay(
    PAYDAYS.map((day) => paycheck(day, 200_000)),
    TODAY,
  )

/** Acme's paystub for 13 November: 2,040.00 take-home, within 5% of the deposit that day. */
const stub = (fields: Partial<PaystubPay> = {}): PaystubPay => ({
  payDate: '2026-11-13',
  cadence: 'biweek',
  netCents: 204_000,
  employerName: 'Acme Corp',
  ...fields,
})

/** A month of one paycheck on a cadence, as the pay reading counts it. */
const monthOf = (cents: number, cadence: PaystubPay['cadence']) =>
  Math.round((cents * PER_YEAR[cadence]) / 12)

describe('withPaystubPay: which source wins', () => {
  it('leaves the deposits as found with no paystub to go by', () => {
    const pay = acmePay()
    expect(withPaystubPay(pay, null)).toBe(pay)
    expect(pay.paycheckCents).toBe(200_000)
  })

  it("sets the job's paycheck and month from the paystub, its paydays still the bank's", () => {
    const pay = acmePay()
    const read = withPaystubPay(pay, stub())
    expect(read.paycheckCents).toBe(204_000)
    expect(read.nextPaycheckCents).toBe(204_000)
    expect(read.monthlyCents).toBe(monthOf(204_000, 'biweek'))
    expect(read.employer).toMatchObject({ paycheckCents: 204_000, fromPaystub: true })
    expect(read.nextPayday).toBe(pay.nextPayday)
    expect(read.employer!.projection).toBe(pay.employer!.projection)
  })

  it("lets the owner's own pay win over the paystub", () => {
    const read = withOwnersPay(
      withPaystubPay(acmePay(), stub()),
      {
        ...NO_PAY_SETTINGS,
        payerSalt: '0'.repeat(32),
        override: {
          amountCents: 300_000,
          cadence: 'biweek',
          nextPayday: '2026-11-27',
          payerId: null,
          besideJobs: false,
          givenOn: TODAY,
        },
      },
      TODAY,
    )
    expect(read.paycheckCents).toBe(300_000)
    expect(read.employer).toMatchObject({ paycheckCents: 300_000, fromPaystub: false })
  })
})

describe('withPaystubPay: only while the paystub fits its job', () => {
  it('ignores a paystub on another cadence, since a paycheck depends on it', () => {
    const pay = acmePay()
    expect(withPaystubPay(pay, stub({ cadence: 'semimonth' }))).toBe(pay)
  })

  it("ignores a paystub once the job's deposits moved after it, as after a raise", () => {
    const deposits = PAYDAYS.map((day, i) => paycheck(day, i < 3 ? 200_000 : 220_000))
    const pay = currentPay(deposits, TODAY)
    // Its payday's deposit was 2,000.00; the usual one now is 2,200.00.
    expect(withPaystubPay(pay, stub({ payDate: '2026-10-02' }))).toBe(pay)
  })

  it('still counts a paystub whose payday matches the deposits, however old within its run', () => {
    const read = withPaystubPay(acmePay(), stub({ payDate: '2026-10-02' }))
    expect(read.paycheckCents).toBe(204_000)
  })

  it('never makes up pay or a payday with no job paying now', () => {
    const none = currentPay([], TODAY)
    expect(withPaystubPay(none, stub())).toBe(none)
  })

  it('reads a paystub naming no payer the bank shows by the deposit that matches it', () => {
    // As when the bank shows only a payroll service's name.
    expect(withPaystubPay(acmePay(), stub({ employerName: 'Initech' })).paycheckCents).toBe(204_000)
    expect(withPaystubPay(acmePay(), stub({ employerName: null })).paycheckCents).toBe(204_000)
  })

  it("falls back to a lone job with no deposit near the payday, only within that job's run", () => {
    // 9 October sits a week from either payday, as if that deposit were missing.
    expect(withPaystubPay(acmePay(), stub({ payDate: '2026-10-09' })).paycheckCents).toBe(204_000)
    // Paid before this job's first paycheck: an earlier job's paystub.
    const pay = acmePay()
    expect(withPaystubPay(pay, stub({ employerName: 'Initech', payDate: '2026-08-01' }))).toBe(pay)
  })

  it('sets a side job it names, leaving the main paycheck and payday alone', () => {
    const pay = currentPay(
      [
        ...PAYDAYS.map((day) => paycheck(day, 200_000)),
        paycheck('2026-11-10', 40_000, 'CORNER CAFE PAYROLL'),
      ],
      TODAY,
    )
    expect(pay.employers).toHaveLength(2)
    const side = pay.employers[1]!
    const read = withPaystubPay(
      pay,
      stub({
        employerName: 'Corner Cafe',
        payDate: '2026-11-10',
        cadence: side.cadence,
        netCents: 41_000,
      }),
    )
    expect(read.employers[1]).toMatchObject({ paycheckCents: 41_000, fromPaystub: true })
    expect(read.employer).toBe(pay.employer)
    expect(read.paycheckCents).toBe(200_000)
    expect(read.nextPayday).toBe(pay.nextPayday)
    expect(read.monthlyCents).toBe(pay.employer!.monthlyCents + monthOf(41_000, side.cadence))
  })
})

describe('withPaystubPay: only where a deposit backs it', () => {
  /** Acme paying 3,000.00 and a side job 800.00 through a payroll service, both every two weeks. */
  const twoJobs = () =>
    currentPay(
      [
        ...PAYDAYS.map((day) => paycheck(day, 300_000)),
        ...everyDays('2026-09-02', 14, 6).map((day) => paycheck(day, 80_000, 'GUSTO PAYROLL')),
      ],
      TODAY,
    )

  it("never lands a side job's paystub on the main job", () => {
    const pay = twoJobs()
    expect(pay.employers).toHaveLength(2)
    // The side job's paystub names an employer the bank never shows.
    const read = withPaystubPay(
      pay,
      stub({ employerName: 'Corner Cafe', payDate: '2026-11-11', netCents: 80_000 }),
    )
    expect(read.employer).toBe(pay.employer)
    expect(read.paycheckCents).toBe(300_000)
    expect(read.employers[1]).toMatchObject({ paycheckCents: 80_000, fromPaystub: true })
    expect(read.monthlyCents).toBe(pay.monthlyCents)
  })

  it('leaves pay alone with several jobs and no deposit to match the paystub', () => {
    const pay = twoJobs()
    // 30 August, as the bank's history starts: no deposit matches it.
    expect(withPaystubPay(pay, stub({ employerName: null, payDate: '2026-08-30' }))).toBe(pay)
    // A paystub matching neither job's deposit that day.
    expect(withPaystubPay(pay, stub({ employerName: null, netCents: 150_000 }))).toBe(pay)
  })

  it('leaves pay as the bank shows it when part of the paycheck goes where Leeway cannot see', () => {
    const pay = acmePay()
    // 2,400.00 take-home, 400.00 of it to an account the bank link does not show.
    expect(withPaystubPay(pay, stub({ netCents: 240_000 }))).toBe(pay)
    expect(withPaystubPay(pay, stub({ employerName: null, netCents: 240_000 }))).toBe(pay)
  })
})
