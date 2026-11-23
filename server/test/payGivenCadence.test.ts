// A cadence the owner gave (domain/pay/given.ts): one with no paystub
// always speaks for the main job, a saved paystub's only for the job it
// came from, so an old job's paystub never sets how a new job pays.
// Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import { currentPay } from '../src/domain/pay/current.js'
import type { Deposit } from '../src/domain/pay/deposits.js'
import { namesPayer, type GivenCadence } from '../src/domain/pay/given.js'

const TODAY = '2026-11-17'

let next = 0
function salary(date: string, name: string, cents: number): Deposit {
  next += 1
  return {
    id: `g${next}`,
    accountId: 'checking',
    date,
    name,
    merchantName: null,
    amountCents: -cents,
    providerCategoryPrimary: null,
    providerCategoryDetailed: 'INCOME_SALARY',
    accountType: 'depository',
    categoryKind: null,
  }
}

/** An old job paid twice a month until Sep 15, then a new one every two weeks from Oct 2. */
const GLOBEX = [
  '2026-06-15',
  '2026-06-30',
  '2026-07-15',
  '2026-07-31',
  '2026-08-14',
  '2026-08-31',
  '2026-09-15',
]
const INITECH = ['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13']
const DEPOSITS = [
  ...GLOBEX.map((date) => salary(date, 'GLOBEX CORP PAYROLL', 250_000)),
  ...INITECH.map((date) => salary(date, 'INITECH PAYROLL', 300_000)),
]

/** A paystub's cadence, from the day and employer it shows. */
const paystub = (
  cadence: GivenCadence['cadence'],
  payDate: string | null,
  employerName: string | null,
) => ({ cadence, paystub: { payDate, employerName } }) satisfies GivenCadence

/**
 * What the new job's four paychecks alone say: every two weeks or the 1st
 * and 15th alike, read cautiously as an estimate (about $6,000 a month,
 * next on Dec 2), never an old job's monthly $3,000 with Dec 14 as fact.
 */
const NEW_JOB = {
  cadence: 'biweek',
  estimate: true,
  monthlyCents: 600_000,
  nextPayday: '2026-12-02',
}

describe("an old job's paystub", () => {
  it('leaves the new job read from its own paychecks', () => {
    expect(currentPay(DEPOSITS, TODAY)).toMatchObject(NEW_JOB)
    for (const cadence of ['month', 'semimonth'] as const) {
      const old = paystub(cadence, '2026-08-31', 'Globex Corporation')
      expect(currentPay(DEPOSITS, TODAY, old)).toMatchObject(NEW_JOB)
    }
  })

  it('is ignored with no pay date when it names another employer, or none', () => {
    expect(currentPay(DEPOSITS, TODAY, paystub('month', null, 'Globex Corporation'))).toMatchObject(
      NEW_JOB,
    )
    expect(currentPay(DEPOSITS, TODAY, paystub('month', null, null))).toMatchObject(NEW_JOB)
  })
})

describe("the main job's own paystub", () => {
  it('sets the cadence when it was paid during the job, from a few days before its first paycheck', () => {
    const ours = paystub('semimonth', '2026-09-28', null)
    expect(currentPay(DEPOSITS, TODAY, ours)).toMatchObject({
      cadence: 'semimonth',
      monthlyCents: 600_000,
    })
    // Six days before the first paycheck is before this job's run.
    const tooEarly = paystub('semimonth', '2026-09-26', null)
    expect(currentPay(DEPOSITS, TODAY, tooEarly)).toMatchObject(NEW_JOB)
  })

  it('sets the cadence when it names the payer, whatever its date', () => {
    const named = paystub('semimonth', null, 'Initech, Inc.')
    expect(currentPay(DEPOSITS, TODAY, named)).toMatchObject({ cadence: 'semimonth' })
  })
})

describe('a cadence given with no paystub', () => {
  it('always sets the main job cadence', () => {
    expect(currentPay(DEPOSITS, TODAY, { cadence: 'semimonth' })).toMatchObject({
      cadence: 'semimonth',
    })
  })
})

describe('namesPayer', () => {
  it('matches a name word, never a company word alone', () => {
    expect(namesPayer('Initech, Inc.', 'initech payroll')).toBe(true)
    expect(namesPayer('Globex Corporation', 'initech payroll')).toBe(false)
    expect(namesPayer('The Payroll Company', 'acme payroll')).toBe(false)
    // A key keeps the number that names its payer; a stub's name is read without it.
    expect(namesPayer('7-Eleven, Inc.', '7eleven dir dep')).toBe(true)
    expect(namesPayer('1199SEIU Benefit Funds', '1199seiu dir dep')).toBe(true)
  })
})
