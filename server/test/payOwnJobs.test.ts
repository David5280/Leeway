// The owner's word with two jobs (pay/ownPay.ts): each word follows the job
// it names by id, wherever that job ranks. Their own pay never takes the
// place of a different job, and a confirmation stays with its job when
// another pays more. Pure.

import { describe, expect, it } from 'vitest'
import { currentPay } from '../src/domain/pay/current.js'
import {
  employerIdOf,
  NO_PAY_SETTINGS,
  ownMonthlyCents,
  readAsConfirmed,
  withOwnersPay,
  type PaySettings,
} from '../src/domain/pay/ownPay.js'
import { payViewOf } from '../src/domain/pay/view.js'
import { settingsSchema } from '../src/domain/settings.js'
import { everyDays, paycheck } from './fixtures/pay.js'

const TODAY = '2026-11-17'

/** The owner's word: what they said, the rest as when they have said nothing. */
const said = (word: Partial<PaySettings>): PaySettings => ({ ...NO_PAY_SETTINGS, ...word })

/** Names every employer by the bank's text: fine for made-up payrolls. */
const byName = (employer: { newest: { name: string } }) => employer.newest.name

describe("the owner's own pay with two jobs", () => {
  // ACME's lone paycheck reads monthly, so GLOBEX's smaller biweekly pay ranks first.
  const deposits = [
    ...everyDays('2026-09-04', 14, 6).map((day) => paycheck(day, 120_000, 'GLOBEX PAYROLL')),
    paycheck('2026-11-06', 210_000),
  ]
  const own = { amountCents: 210_000, cadence: 'biweek' as const, nextPayday: '2026-11-20' }

  it('stands in for the job it was entered for, keeping the other job beside it', () => {
    const pay = currentPay(deposits, TODAY)
    const [globex, acme] = pay.employers
    expect(acme!.newest.name).toBe('ACME CORP PAYROLL')
    const payerId = employerIdOf(acme!, NO_PAY_SETTINGS)
    const given = withOwnersPay(pay, said({ override: { ...own, payerId } }), TODAY)
    // ACME every two weeks, plus GLOBEX's month, never ACME's month again.
    expect(given.monthlyCents).toBe(456_563 + globex!.monthlyCents)
    expect(given.employers.map(byName)).toEqual(['ACME CORP PAYROLL', 'GLOBEX PAYROLL'])
    expect(given.nextPayday).toBe('2026-11-20')
  })
})

describe('when the job the pay was entered for stops', () => {
  // ACME every two weeks until Oct 2, GLOBEX every week still.
  const acme = everyDays('2026-07-10', 14, 7).map((day) => paycheck(day, 210_000))
  const globex = everyDays('2026-07-09', 7, 19).map((day) =>
    paycheck(day, 40_000, 'GLOBEX PAYROLL'),
  )
  const deposits = [...acme, ...globex]
  const own = { amountCents: 220_000, cadence: 'biweek' as const, nextPayday: '2026-11-20' }
  const SEPTEMBER = '2026-09-20'
  /** The paychecks that had landed by Sep 20, while ACME still paid. */
  const bySeptember = deposits.filter((deposit) => deposit.date <= SEPTEMBER)

  /** The pay entered for ACME while it still paid, in September. */
  function enteredForAcme(): PaySettings {
    const then = currentPay(bySeptember, SEPTEMBER)
    expect(then.employer!.newest.name).toBe('ACME CORP PAYROLL')
    return said({ override: { ...own, payerId: employerIdOf(then.employer!, NO_PAY_SETTINGS) } })
  }

  it('replaces no other job: every job still paying keeps counting beside it', () => {
    const pay = currentPay(deposits, TODAY)
    // ACME has stopped; only GLOBEX pays now, at about 173,929 a month.
    expect(pay.employers.map(byName)).toEqual(['GLOBEX PAYROLL'])
    const word = enteredForAcme()
    const given = withOwnersPay(pay, word, TODAY)
    expect(given.monthlyCents).toBe(ownMonthlyCents(own) + pay.employers[0]!.monthlyCents)
    expect(given.employers.map(byName)).toEqual(['GLOBEX PAYROLL'])
    // The payday stays the owner's own, never an estimate.
    expect(given).toMatchObject({ nextPayday: '2026-11-20', employer: null })
  })

  it('says so, and marks no job as replaced', () => {
    const settings = settingsSchema.parse({ pay: enteredForAcme() })
    const view = payViewOf(currentPay(deposits, TODAY), settings, TODAY, byName)
    expect(view.yours).toMatchObject({ amountCents: 220_000, jobStopped: true })
    expect(view.found!.employers).toMatchObject([{ name: 'GLOBEX PAYROLL', replaced: false }])
    expect(view.pay!.monthlyCents).toBe(ownMonthlyCents(own) + 173_929)
  })

  it('is not said while that job still pays', () => {
    const settings = settingsSchema.parse({ pay: enteredForAcme() })
    const view = payViewOf(currentPay(bySeptember, SEPTEMBER), settings, SEPTEMBER, byName)
    expect(view.yours!.jobStopped).toBe(false)
    expect(view.found!.employers.find((employer) => employer.replaced)!.name).toBe(
      'ACME CORP PAYROLL',
    )
  })
})

describe('a confirmation when another job pays more', () => {
  // Paydays that fit every two weeks and twice a month alike: read cautiously as found.
  const acme = ['2026-10-15', '2026-10-30', '2026-11-13'].map((day) => paycheck(day, 210_000))
  const globex = everyDays('2026-10-01', 7, 7).map((day) => paycheck(day, 150_000, 'GLOBEX PAY'))

  /** ACME confirmed every two weeks, while it was the only job. */
  function confirmedAcme(): PaySettings {
    const alone = currentPay(acme, TODAY)
    const payerId = employerIdOf(alone.employer!, NO_PAY_SETTINGS)
    return said({ confirmed: { payerId, cadence: 'biweek' } })
  }

  it('stays with its job, read the way the owner confirmed', () => {
    const deposits = [...acme, ...globex]
    const found = currentPay(deposits, TODAY)
    expect(found.employers.map(byName)).toEqual(['GLOBEX PAY', 'ACME CORP PAYROLL'])
    const word = confirmedAcme()
    const read = withOwnersPay(readAsConfirmed(deposits, found, word, TODAY), word, TODAY)
    // Every two weeks from Nov 13, no longer the cautious twice-a-month guess.
    expect(read.employers[1]).toMatchObject({
      cadence: 'biweek',
      estimate: false,
      monthlyCents: 456_563,
      nextPayday: '2026-11-27',
    })
  })

  it('reads as confirmed, never stale', () => {
    const deposits = [...acme, ...globex]
    const word = confirmedAcme()
    const found = readAsConfirmed(deposits, currentPay(deposits, TODAY), word, TODAY)
    const view = payViewOf(found, settingsSchema.parse({ pay: word }), TODAY, byName)
    expect(view.found).toMatchObject({ confirmed: true, confirmationStale: false })
    expect(view.found!.employers.map(({ name, confirmed }) => ({ name, confirmed }))).toEqual([
      { name: 'GLOBEX PAY', confirmed: false },
      { name: 'ACME CORP PAYROLL', confirmed: true },
    ])
    expect(view.pay!.source).toBe('confirmed')
  })
})

describe('employerIdOf', () => {
  it('keys a payer id with the salt, so the same payer reads alike only on one install', () => {
    const { employer } = currentPay([paycheck('2026-11-13', 210_000)], TODAY)
    const one = { payerSalt: '0'.repeat(32) }
    const other = { payerSalt: 'f'.repeat(32) }
    expect(employerIdOf(employer!, one)).toMatch(/^[0-9a-f]{16}$/)
    expect(employerIdOf(employer!, one)).toBe(employerIdOf(employer!, one))
    expect(employerIdOf(employer!, one)).not.toBe(employerIdOf(employer!, other))
  })
})
