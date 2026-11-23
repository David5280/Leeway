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
  // name, as banks write it: an ACH line's "CO" labels name no company.
  const PERSON_PAYERS = [
    'JOHN SMITH DIR DEP',
    'ORIG CO NAME:JOHN SMITH ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD',
    'JOHN SMITH DES:PAYROLL ID:XXXXX INDN:DOE JANE CO ID:XXXXX PPD',
  ]

  /** Five biweekly paychecks of $1,500 under the given bank text, and the profile they make. */
  async function paidBy(name: string) {
    const checking = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 300_000 })
    for (const date of ['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30']) {
      await insertBankTransaction(ctx.db, checking.accountId, { date, name, amountCents: -150_000 })
    }
    return profile()
  }

  it.each(PERSON_PAYERS)(
    'never names a person who pays a wage, in the profile or the digest the AI reads: %s',
    async (name) => {
      const result = await paidBy(name)
      expect(result.pay).toMatchObject({
        cadence: 'biweek',
        employer: null,
        typicalPayCents: 150_000,
      })
      expect(result.pay.employers.map((employer) => employer.name)).toEqual([null])
      const { digest } = await call('get_financial_profile')
      expect(digest).toContain('Pay: every 2 weeks since Sep 4, about $1,500 each')
      expect(digest).not.toMatch(/john|smith|jane|doe|dir dep/i)
    },
  )

  it('still names a business paying through the same ACH line', async () => {
    const result = await paidBy(
      'ORIG CO NAME:ACME CORP ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD IND NAME:JANE DOE',
    )
    expect(result.pay.employer).toBe('Acme Corp')
    expect(JSON.stringify(result.pay)).not.toMatch(/jane|doe/i)
  })
})
