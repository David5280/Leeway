// A cadence the owner gave (domain/pay/given.ts): a paycheck budget
// period's always speaks for the main job, a saved paystub's only for the
// job it came from, so an old job's paystub never sets how a new job pays.
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

/**
 * An old job paid twice a month until Jul 31, then a new one with a name
 * that shares a word with it every two weeks from Aug 14.
 */
function sharedWordJobs() {
  const old = ['2026-04-15', '2026-04-30', '2026-05-15', '2026-05-29', '2026-06-15', '2026-06-30']
  const fridays = ['2026-08-14', '2026-08-28', '2026-09-11', '2026-09-25', '2026-10-09']
  return [
    ...[...old, '2026-07-15', '2026-07-31'].map((date) =>
      salary(date, 'STATE OF COLORADO PAYROLL', 250_000),
    ),
    ...[...fridays, '2026-10-23', '2026-11-06'].map((date) =>
      salary(date, 'UNIV OF COLORADO PAYROLL', 300_000),
    ),
  ]
}

/** The new job read from its own seven Fridays: every two weeks, next Nov 20, $3,000 each. */
const NEW_FRIDAYS = { cadence: 'biweek', monthlyCents: 652_232, nextPayday: '2026-11-20' }

describe("an old job's paystub naming a word the new job shares", () => {
  it('leaves the new job read from its own paychecks', () => {
    const old = paystub('semimonth', '2026-07-31', 'State of Colorado')
    expect(currentPay(sharedWordJobs(), TODAY, old)).toMatchObject(NEW_FRIDAYS)
  })

  it('is the old job’s even when dated during the new job’s first paychecks', () => {
    // The old job's final stub, paid Aug 16, two days after the new job's first paycheck.
    const final = paystub('semimonth', '2026-08-16', 'State of Colorado')
    expect(currentPay(sharedWordJobs(), TODAY, final)).toMatchObject(NEW_FRIDAYS)
    // A stub naming no payer seen, as when the bank shows only a payroll
    // service, still counts by its date.
    const unnamed = paystub('semimonth', '2026-08-16', 'Payroll Services LLC')
    expect(currentPay(sharedWordJobs(), TODAY, unnamed)).toMatchObject({ cadence: 'semimonth' })
  })

  it('still sets the new job’s cadence when it names the new job', () => {
    const named = paystub('semimonth', null, 'Univ. of Colorado')
    expect(currentPay(sharedWordJobs(), TODAY, named)).toMatchObject({ cadence: 'semimonth' })
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

describe('a paycheck budget period', () => {
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

  it('never matches on one shared word alone', () => {
    expect(namesPayer('State of Colorado', 'univ of colorado payroll')).toBe(false)
    expect(namesPayer('Denver Public Schools', 'cherry creek schools payroll')).toBe(false)
    expect(namesPayer('Bank of the West', 'first bank payroll')).toBe(false)
    expect(namesPayer('State of Colorado', 'state farm payroll')).toBe(false)
  })

  it('matches the same leading words, or most of the stub’s name in the bank’s line', () => {
    expect(namesPayer('State of Colorado', 'state of colorado payroll')).toBe(true)
    expect(namesPayer('Denver Public Schools', 'denver public schools dir dep')).toBe(true)
    expect(namesPayer('Acme Widgets Inc', 'acme payroll')).toBe(true)
    // An ACH line puts its own labels before the company.
    expect(namesPayer('Acme Corp', 'orig co name acme corp orig co entry descr payroll')).toBe(true)
  })

  it('reads a short form the bank prints as the word the stub spells out', () => {
    expect(namesPayer('University of Colorado', 'univ of colorado payroll')).toBe(true)
    expect(namesPayer('Acme International', 'acme intl payroll')).toBe(true)
    expect(namesPayer('Acme Svcs', 'acme services dir dep')).toBe(true)
    // Spelled out, two employers that share one word are still two.
    expect(namesPayer('State of Colorado', 'univ of colorado payroll')).toBe(false)
  })
})
