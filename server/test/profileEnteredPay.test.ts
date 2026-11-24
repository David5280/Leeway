// What the AI is told of pay the owner entered (profile/income.ts and
// payDigest.ts): said to be theirs, never credited to a job it only counts
// beside, as when the job it was entered for has stopped. Every name and
// amount is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { getSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import { BIWEEKLY, everyDays, insertPaychecks } from './fixtures/pay.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

let ctx: AppContext
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** The financial profile as the AI's digest is written from it, on the test clock's day. */
const profile = async () => getFinancialProfile(ctx.db, await getSettings(ctx.db), '2026-11-17')

/** The digest's line about pay. */
async function payLine(): Promise<string> {
  const { digest } = await call('get_financial_profile')
  return digest.split('\n').find((line) => line.startsWith('Pay:'))!
}

const OWN = { amountCents: 320_000, cadence: 'biweek', nextPayday: '2026-11-27' } as const

describe('pay the owner entered, in the financial profile', () => {
  it('stays theirs when the job it was entered for stops, beside the job still paying', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertPaychecks(ctx.db, accountId, BIWEEKLY, 210_000)
    await call('set_pay', { pay: OWN })
    // ACME's paychecks move back to the summer, so it has stopped; GLOBEX pays monthly.
    await ctx.db.query(`UPDATE transactions SET date = date - 70 WHERE name LIKE 'ACME%'`)
    const globex = ['2026-08-31', '2026-09-30', '2026-10-30']
    await insertPaychecks(ctx.db, accountId, globex, 80_000, 'GLOBEX INC PAYROLL')

    const line = await payLine()
    expect(line).toMatch(
      /^Pay: the owner's own pay, as they entered it, every 2 weeks, about \$3,200/,
    )
    expect(line).toMatch(
      /It counts beside Globex Inc Payroll monthly since Aug 31, about \$800 each/,
    )
    // GLOBEX is never said to pay the $3,200.
    expect(line).not.toMatch(/from Globex/)

    const { pay } = await profile()
    expect(pay).toMatchObject({
      employer: null,
      entered: { cadence: 'biweek', typicalPayCents: 320_000, nextPayday: '2026-11-27' },
      employers: [{ name: 'Globex Inc Payroll', typicalPayCents: 80_000 }],
    })
  })

  it('stands in for its job while that job still pays, named as that job', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertPaychecks(ctx.db, accountId, everyDays('2026-09-04', 14, 6), 210_000)
    await call('set_pay', { pay: OWN })
    const { pay } = await profile()
    expect(pay).toMatchObject({
      employer: 'Acme Corp Payroll',
      entered: null,
      typicalPayCents: 320_000,
    })
    expect(await payLine()).toMatch(/^Pay: every 2 weeks from Acme Corp Payroll/)
  })
})
