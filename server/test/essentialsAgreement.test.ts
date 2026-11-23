// The emergency fund's essentials (monthlyEssentials.ts) and the financial
// profile's (profile/income.ts) read one way (essentialMonths.ts), each over
// its own stretch: from categories, never a card payment, even one to a card
// Leeway cannot see; with nothing essential, all spending as a typical month
// counts it, such a payment included. Every name and amount is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { typicalMonth } from '../src/domain/profile/income.js'
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
const CARD_PAYMENT = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'

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

/** [name, cents, category id, bank code] paid out of checking on the 1st, August to November. */
async function monthly(lines: [string, number, string, string | null][]) {
  const checking = await insertBankAccount(ctx.db, { subtype: 'checking' })
  for (const month of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    for (const [name, amountCents, categoryId, detailed] of lines) {
      const id = await insertBankTransaction(ctx.db, checking.accountId, {
        date: `${month}-01`,
        name,
        amountCents,
        detailed,
      })
      await ctx.db.query(
        `UPDATE transactions SET category_id = $2, category_source = 'manual' WHERE id = $1`,
        [id, categoryId],
      )
    }
  }
}

/** The fund's essentials a month, and the profile's with its stretch's spending. */
async function bothReadings() {
  const fund = (await call('get_emergency_fund'))!.essentials!.cents
  const { monthly: profile } = await typicalMonth(ctx.db, await getSettings(ctx.db), TODAY)
  // The profile's stretch, Aug 20 to Nov 18, holds three of the 1sts: Sep, Oct and Nov.
  const asProfile = (cents: number) =>
    Math.round((3 * cents * (365.25 / 12)) / profile.spendingDays)
  return { fund, profile, asProfile }
}

describe('essentials in the fund and the profile', () => {
  it("agree on the owner's pick, leaving out a payment to a card Leeway cannot see", async () => {
    const rent = await call('create_category', { name: 'Rent' })
    const debts = await call('create_category', { name: 'Debt payments' })
    await monthly([
      ['Landlord', 150_000, rent.id, null],
      ['Student loan servicer', 30_000, debts.id, 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT'],
      ['Card payment', 120_000, debts.id, CARD_PAYMENT],
    ])
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [rent.id, debts.id] } })
    const { fund, profile, asProfile } = await bothReadings()
    expect(fund).toBe(180_000)
    expect(profile.essentialSpendingCents).toBe(asProfile(180_000))
    // Typical spending still counts the payment: the only trace of what was bought.
    expect(profile.spendingCents).toBe(asProfile(300_000))
  })

  it('count all spending as a typical month does when nothing reads as essential', async () => {
    const fun = await call('create_category', { name: 'Fun' })
    await monthly([
      ['Arcade', 50_000, fun.id, null],
      ['Card payment', 100_000, fun.id, CARD_PAYMENT],
    ])
    const { fund, profile, asProfile } = await bothReadings()
    // An owner paying by a card Leeway cannot see keeps a fund sized by that spending.
    expect(fund).toBe(150_000)
    expect(profile.essentialSpendingCents).toBe(asProfile(150_000))
    expect(profile.essentialSpendingCents).toBe(profile.spendingCents)
  })
})
