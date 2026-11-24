// Who the financial profile names as paying the owner (profile/income.ts):
// only a business, never a person who pays a wage under their own name, nor
// an account number. Every name and number is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { getSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver.
let ctx: AppContext
const { call } = actionCaller(() => ctx)
const TODAY = '2026-11-19'

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-19T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  await ctx.db.query(`UPDATE settings SET data = '{"timeZone": "America/Denver"}'`)
})

const profile = async () => getFinancialProfile(ctx.db, await getSettings(ctx.db), TODAY)

describe('the payers the profile names', () => {
  it('counts a second job beside the first, naming only a business, never an account number', async () => {
    const checking = await insertBankAccount(ctx.db, { subtype: 'checking', mask: '4821' })
    const pay = (date: string, name: string, amountCents: number) =>
      insertBankTransaction(ctx.db, checking.accountId, {
        date,
        name,
        amountCents: -amountCents,
        detailed: 'INCOME_SALARY',
      })
    for (const date of ['2026-10-15', '2026-10-30', '2026-11-13']) {
      await pay(date, 'INITECH PAYROLL', 200_000)
    }
    // Six Fridays, enough to settle every two weeks.
    for (const date of [
      '2026-08-28',
      '2026-09-11',
      '2026-09-25',
      '2026-10-09',
      '2026-10-23',
      '2026-11-06',
    ]) {
      await pay(date, 'BLUTH CO PAYROLL ACCT 4821', 60_000)
    }
    const result = await profile()
    // $4,000 a month plus $600 every two weeks.
    expect(result.monthly.incomeCents).toBe(400_000 + 130_446)
    // Three checks near the 15th and month end could be either cadence: the
    // cautious reading counts the lower monthly pay and the later payday (the
    // 1st, since Friday Oct 30 fits a Sunday the 1st too), and ends the period
    // at the main job's payday, not the side job's.
    expect(result.pay).toMatchObject({
      cadence: 'biweek',
      employer: null,
      nextPayday: '2026-12-01',
      since: '2026-08-28',
      estimate: true,
    })
    expect(result.pay.employers.map((e) => [e.name, e.cadence, e.monthlyCents])).toEqual([
      // Only the one the bank names as a business is named.
      [null, 'biweek', 400_000],
      ['Bluth Co Payroll', 'biweek', 130_446],
    ])
    expect(JSON.stringify(result.pay)).not.toContain('4821')
  })

  // A household or a sole trader paying by direct deposit under their own
  // name, as banks write it: an ACH line's "CO" labels name no company, nor
  // does a trailing state, before a pay word ("DENVER CO DIR DEP") or an ACH
  // label ("DENVER CO DES:PAYROLL"), nor a word an ACH line prints after its
  // pay word ("DES:PAYROLL CO ID"). A bank code, where given, is the one some
  // banks put on such a line.
  const PERSON_PAYERS: [name: string, code: string | null][] = [
    ['JOHN SMITH DIR DEP', null],
    ['ORIG CO NAME:JOHN SMITH ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD', null],
    ['JOHN SMITH DES:PAYROLL ID:XXXXX INDN:DOE JANE CO ID:XXXXX PPD', null],
    ['JOHN SMITH DES:PAYROLL CO ID:XXXXX PPD', null],
    ['JOHN SMITH DENVER CO DIR DEP', null],
    ['JANE DOE CO PAYROLL', 'TRANSFER_IN_DEPOSIT'],
    // A state ends an ACH line's payer as it does a plain line's.
    ['JOHN SMITH DENVER CO DES:PAYROLL ID:1234 INDN:SMITH JOHN CO ID:999 PPD', null],
    [
      'ORIG CO NAME:JOHN SMITH DENVER CO ORIG ID:12 DESC DATE: CO ENTRY DESCR:DIR DEP SEC:PPD',
      null,
    ],
    ['JANE DOE CO DES:PAYROLL ID:1 INDN:X CO ID:9 PPD', null],
    ['Transfer from Jane Doe CO salary', 'INCOME_SALARY'],
    // A word between the state and the pay word: how often, or the ACH rails.
    ['JANE DOE CO WEEKLY PAYROLL', null],
    ['JOHN SMITH DENVER CO ACH PAYROLL', null],
    ['JANE DOE CO MONTHLY SALARY', 'INCOME_SALARY'],
    ['JANE DOE DENVER CO EFT PAYROLL', null],
    // As some banks write it, in title case.
    ['Jane Doe Co DES:PAYROLL ID:1', null],
    // Any word after the state, under a salary code or none: a "CO" is the
    // company only when taking off a place leaves the words up to it whole.
    ['JANE DOE CO BI-WEEKLY PAY', 'INCOME_SALARY'],
    ['JANE DOE CO PAY', 'INCOME_SALARY'],
    ['JANE DOE CO DES:PAY ID:1', 'INCOME_SALARY'],
    ['JANE DOE CO PAYROLL 12', null],
    ['JANE DOE CO PAYROLL NOV 15', null],
    ['JANE DOE CO SEMI MONTHLY PAYROLL', null],
    ['JANE DOE CO BI WEEKLY PAYROLL', null],
    ['JANE DOE CO WKLY PAYROLL', null],
    ['JANE DOE CO. PAYROLL', null],
    ['JANE DOE CO BONUS PAYROLL', null],
    ['JANE DOE CO PAYROLL PMT', null],
    ['JANE DOE CO ACH CREDIT PAYROLL', 'INCOME_SALARY'],
    ['JANE DOE CO PAYROLL CREDIT', 'INCOME_SALARY'],
    ['JANE DOE CO PAYROLL TRANSFER', 'INCOME_SALARY'],
    ['JANE DOE CO DD', 'INCOME_SALARY'],
    ['JANE DOE CO SALARY 15', 'INCOME_SALARY'],
    ['Transfer from Jane Doe Co bi-weekly pay', 'INCOME_SALARY'],
    ['From Jane Doe Co payroll bonus', 'INCOME_SALARY'],
    // A second "CO" later in the line, which a place taken off would leave
    // the person's own "CO" behind.
    ['JANE DOE CO ACH CO PAYROLL', null],
    ['JOHN SMITH DENVER CO ACH CO PAYROLL', null],
    // A surname that is also a business word ("MILLS") keeps its "CO" a state.
    ['JOHN MILLS CO PAYROLL', null],
    ['JANE MARKET CO PAYROLL', 'INCOME_SALARY'],
    ['JANE ANN MILLS CO DIR DEP', null],
  ]

  /** Five biweekly paychecks of $1,500 under the given bank text and code, and the profile they make. */
  async function paidBy(name: string, detailed: string | null = null) {
    const checking = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 300_000 })
    for (const date of ['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30']) {
      await insertBankTransaction(ctx.db, checking.accountId, {
        date,
        name,
        amountCents: -150_000,
        detailed,
      })
    }
    return profile()
  }

  it.each(PERSON_PAYERS)(
    'never names a person who pays a wage, in the profile or the digest the AI reads: %s',
    async (name, code) => {
      const result = await paidBy(name, code)
      expect(result.pay).toMatchObject({
        cadence: 'biweek',
        employer: null,
        typicalPayCents: 150_000,
      })
      expect(result.pay.employers.map((employer) => employer.name)).toEqual([null])
      const { digest } = await call('get_financial_profile')
      expect(digest).toContain('Pay: every 2 weeks since Sep 4, about $1,500 each')
      expect(digest).not.toMatch(/john|smith|jane|doe|mills|market|denver|dir dep/i)
    },
  )

  it('still names a business paying through the same ACH line', async () => {
    const result = await paidBy(
      'ORIG CO NAME:ACME CORP ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD IND NAME:JANE DOE',
    )
    expect(result.pay.employer).toBe('Acme Corp')
    expect(JSON.stringify(result.pay)).not.toMatch(/jane|doe/i)
  })

  it.each([
    ['ACME CO PAYROLL', 'Acme Co Payroll'],
    ['ACME CO DES:PAYROLL ID:XXXXX INDN:DOE JANE CO ID:XXXXX PPD', 'Acme Co Payroll'],
    ['3M CO DES:PAYROLL ID:XXXXX INDN:DOE JANE CO ID:XXXXX PPD', '3m Co Payroll'],
    ['ORIG CO NAME:ACME INC ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD', 'Acme Inc'],
    ['GREAT DIVIDE BREWING CO DIR DEP', 'Great Divide Brewing Co Dir Dep'],
    ['ACME CO WEEKLY PAYROLL', 'Acme Co Weekly Payroll'],
    ['Acme Co Payroll', 'Acme Co Payroll'],
    ['3M CO DES:PAYROLL', '3m Co Payroll'],
    ['ACME INC ACH PAYROLL', 'Acme Inc ACH Payroll'],
    ['GREAT DIVIDE BREWING CO PAYROLL', 'Great Divide Brewing Co Payroll'],
    // A business ending before the place still names the business.
    ['ACME LLC DENVER CO PAYROLL', 'Acme LLC Denver Co Payroll'],
    // Whatever follows the ending, the business is still named.
    ['IDEAL CO PAYROLL', 'Ideal Co Payroll'],
    ['ACME & CO PAYROLL', 'Acme & Co Payroll'],
    ['SMITH AND CO PAYROLL', 'Smith and Co Payroll'],
    ['ACME CO DENVER CO PAYROLL', 'Acme Co Denver Co Payroll'],
    ['FORD MOTOR CO PAYROLL', 'Ford Motor Co Payroll'],
    ['ACME CO BONUS PAYROLL', 'Acme Co Bonus Payroll'],
    ['ACME CO PAYROLL 12', 'Acme Co Payroll 12'],
    ['ACME COMPANY PAYROLL', 'Acme Company Payroll'],
    ['ADP PAYROLL FOR ACME INC', 'Adp Payroll for Acme Inc'],
  ])('still names a business by its ending: %s', async (name, shown) => {
    const result = await paidBy(name)
    expect(result.pay.employer).toBe(shown)
    expect(JSON.stringify(result.pay)).not.toMatch(/jane|doe/i)
  })
})
