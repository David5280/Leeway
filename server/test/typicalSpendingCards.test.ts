// Typical spending and credit card payments (monthlyTotals.spendingByRange):
// paid to a card Leeway cannot see, the payment is the only trace of what
// was bought and counts; paid to a card it tracks, the purchases count and
// the payment never does, on either side. Every name and amount is made up.

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

const profile = async () => getFinancialProfile(ctx.db, await getSettings(ctx.db), TODAY)

/** A line on an account, filed under `categoryId` by hand when one is given. */
async function line(
  accountId: string,
  date: string,
  name: string,
  amountCents: number,
  {
    detailed = null,
    categoryId = null,
  }: { detailed?: string | null; categoryId?: string | null } = {},
) {
  const id = await insertBankTransaction(ctx.db, accountId, { date, name, amountCents, detailed })
  if (categoryId) {
    await ctx.db.query(
      `UPDATE transactions SET category_id = $2, category_source = 'manual' WHERE id = $1`,
      [id, categoryId],
    )
  }
}

/** Fridays every two weeks from Aug 7: $2,500 each. */
const PAYDAYS = ['2026-08-07', '2026-08-21', '2026-09-04', '2026-09-18', '2026-10-02'].concat([
  '2026-10-16',
  '2026-10-30',
  '2026-11-13',
])
/** Inside the 91 days typical spending reads, from Aug 20. */
const PAYMENT_DAYS = ['2026-09-10', '2026-10-10', '2026-11-10']
const RENT_DAYS = ['2026-09-01', '2026-10-01', '2026-11-01']

/** Checking with pay and $1,500 rent a month, filed; the account and the rent category. */
async function checkingWithPayAndRent() {
  const checking = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 200_000 })
  const rent = await call('create_category', { name: 'Rent' })
  for (const date of PAYDAYS) {
    await line(checking.accountId, date, 'ACME PAYROLL', -250_000, { detailed: 'INCOME_SALARY' })
  }
  for (const date of RENT_DAYS) {
    await line(checking.accountId, date, 'RENT', 150_000, { categoryId: rent.id })
  }
  return checking
}

/** What a month of `cents` spent over the profile's window comes to. */
async function spendingOf(cents: number) {
  const { monthly } = await profile()
  expect(monthly.spendingSince).toBe('2026-08-20')
  return {
    actual: monthly.spendingCents,
    expected: Math.round((cents * 365.25) / 12 / monthly.spendingDays),
  }
}

describe('typical spending with credit card payments', () => {
  it('counts payments to a card Leeway cannot see, the only trace of that spending', async () => {
    const checking = await checkingWithPayAndRent()
    for (const date of PAYMENT_DAYS) {
      await line(checking.accountId, date, 'CITI CARD ONLINE PAYMENT', 300_000, {
        detailed: CARD_PAYMENT,
      })
    }
    // $9,000 to the card and $4,500 of rent: about $4,500 a month, not $1,500.
    const { actual, expected } = await spendingOf(3 * 300_000 + 3 * 150_000)
    expect(actual).toBe(expected)
    expect(actual).toBeGreaterThan(450_000)
  })

  it('counts a tracked card purchases and never its payments, either side, however filed', async () => {
    const checking = await checkingWithPayAndRent()
    const card = await insertBankAccount(ctx.db, {
      type: 'credit',
      subtype: 'credit card',
      mask: '4321',
    })
    const transfers = await call('create_category', { name: 'Transfers', kind: 'transfer' })
    const shopping = await call('create_category', { name: 'Shopping' })
    for (const date of PAYMENT_DAYS) {
      await line(card.accountId, date, 'GROCER', 300_000, { categoryId: shopping.id })
      // The checking side filed as the transfer it is; the card side filed as shopping by mistake.
      await line(checking.accountId, date, 'CITI CARD PAYMENT', 300_000, {
        detailed: CARD_PAYMENT,
        categoryId: transfers.id,
      })
      await line(card.accountId, date, 'PAYMENT THANK YOU', -300_000, {
        detailed: CARD_PAYMENT,
        categoryId: shopping.id,
      })
    }
    const { actual, expected } = await spendingOf(3 * 300_000 + 3 * 150_000)
    expect(actual).toBe(expected)
  })

  it('pairs an unfiled payment with the tracked card side, counting neither', async () => {
    const checking = await checkingWithPayAndRent()
    const card = await insertBankAccount(ctx.db, {
      type: 'credit',
      subtype: 'credit card',
      mask: '4321',
    })
    for (const date of PAYMENT_DAYS) {
      await line(checking.accountId, date, 'CITI CARD PAYMENT', 300_000, { detailed: CARD_PAYMENT })
      await line(card.accountId, date, 'PAYMENT THANK YOU', -300_000, { detailed: CARD_PAYMENT })
    }
    const { actual, expected } = await spendingOf(3 * 150_000)
    expect(actual).toBe(expected)
  })
})
