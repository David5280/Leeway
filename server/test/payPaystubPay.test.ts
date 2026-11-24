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

/** Acme's paystub for 13 November: 2,500.00 take-home, part of it paid where the bank cannot see. */
const stub = (fields: Partial<PaystubPay> = {}): PaystubPay => ({
  payDate: '2026-11-13',
  cadence: 'biweek',
  netCents: 250_000,
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
    expect(read.paycheckCents).toBe(250_000)
    expect(read.nextPaycheckCents).toBe(250_000)
    expect(read.monthlyCents).toBe(monthOf(250_000, 'biweek'))
    expect(read.employer).toMatchObject({ paycheckCents: 250_000, fromPaystub: true })
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
    expect(read.paycheckCents).toBe(250_000)
  })

  it('never makes up pay or a payday with no job paying now', () => {
    const none = currentPay([], TODAY)
    expect(withPaystubPay(none, stub())).toBe(none)
  })

  it('reads a paystub naming no payer the bank shows as the main job only within its run', () => {
    // As when the bank shows only a payroll service's name.
    expect(withPaystubPay(acmePay(), stub({ employerName: 'Initech' })).paycheckCents).toBe(250_000)
    expect(withPaystubPay(acmePay(), stub({ employerName: null })).paycheckCents).toBe(250_000)
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
        netCents: 45_000,
      }),
    )
    expect(read.employers[1]).toMatchObject({ paycheckCents: 45_000, fromPaystub: true })
    expect(read.employer).toBe(pay.employer)
    expect(read.paycheckCents).toBe(200_000)
    expect(read.nextPayday).toBe(pay.nextPayday)
    expect(read.monthlyCents).toBe(pay.employer!.monthlyCents + monthOf(45_000, side.cadence))
  })
})
