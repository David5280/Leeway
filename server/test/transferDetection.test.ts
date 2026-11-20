import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { budgetSummary } from '../src/domain/budgetReport.js'
import { nextPayday } from '../src/domain/cashFlow.js'
import { createCategory, listCategories } from '../src/domain/categories.js'
import { recategorize } from '../src/domain/categorize.js'
import { linkBank, removeConnection } from '../src/domain/connections.js'
import { settingsSchema } from '../src/domain/settings.js'
import { STARTER_CATEGORIES } from '../src/domain/starters.js'
import { syncConnection } from '../src/domain/sync.js'
import { actionCaller } from './actionCaller.js'
import { account, bankTx, FakeBank, newLink, page } from './fakeBank.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

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
  ctx.bank = null
})

/** Creates the whole starter set; returns category ids by name. */
async function starterSet(): Promise<Map<string, string>> {
  for (const { formerly: _formerly, ...category } of STARTER_CATEGORIES) {
    await createCategory(ctx.db, category)
  }
  return new Map((await listCategories(ctx.db)).map((c) => [c.name, c.id]))
}

/** The name of the category each transaction ended up in, by description. */
async function filed(): Promise<Record<string, string | null>> {
  const { rows } = await ctx.db.query<{ name: string; category: string | null }>(
    `SELECT t.name, c.name AS category FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id ORDER BY t.name`,
  )
  return Object.fromEntries(rows.map((r) => [r.name, r.category]))
}

const CARD_PAYMENT = 'Payment to Chase card ending in 4321 11/02'

/** A checking account paying a card, and that card, as two connected accounts. */
async function checkingAndCard(cardFields: { hidden?: boolean } = {}) {
  const checking = await insertBankAccount(ctx.db)
  const card = await insertBankAccount(ctx.db, { name: 'Sapphire', type: 'credit', ...cardFields })
  await ctx.db.query(`UPDATE accounts SET mask = '4321' WHERE id = $1`, [card.accountId])
  await insertBankTransaction(ctx.db, checking.accountId, {
    date: '2026-11-03',
    name: CARD_PAYMENT,
    amountCents: 200000,
    primary: 'LOAN_PAYMENTS',
    detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
  })
  await insertBankTransaction(ctx.db, card.accountId, {
    date: '2026-11-04',
    name: 'Payment Thank You-Mobile',
    amountCents: -200000,
    primary: 'LOAN_PAYMENTS',
    detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
  })
  return { checking, card }
}

describe('deciding transfers from the accounts tracked here', () => {
  it('files both sides of a payment to a tracked card as transfers', async () => {
    await starterSet()
    await checkingAndCard()
    await recategorize(ctx.db)

    expect(await filed()).toEqual({
      [CARD_PAYMENT]: 'Transfers',
      'Payment Thank You-Mobile': 'Transfers',
    })
  })

  it('counts a payment to a card hidden from budgets as spending, and back when shown', async () => {
    await starterSet()
    const { card } = await checkingAndCard()
    await recategorize(ctx.db)

    await call('update_account', { id: card.accountId, hidden: true })
    expect((await filed())[CARD_PAYMENT]).toBe('Debt payments')

    await call('update_account', { id: card.accountId, hidden: false })
    expect((await filed())[CARD_PAYMENT]).toBe('Transfers')
  })

  it('leaves categories alone when an account other than a card is hidden', async () => {
    await starterSet()
    const { checking } = await checkingAndCard()
    await recategorize(ctx.db)
    await ctx.db.query(`UPDATE transactions SET category_id = NULL`)

    await call('update_account', { id: checking.accountId, hidden: true })

    // Nothing re-ran, so the cleared categories stay cleared.
    expect(Object.values(await filed())).toEqual([null, null])
  })

  it('counts card payments again once the card is no longer tracked', async () => {
    const bank = new FakeBank()
    ctx.bank = bank
    await starterSet()
    const checking = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-11-03',
      name: CARD_PAYMENT,
      amountCents: 200000,
      primary: 'LOAN_PAYMENTS',
      detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    })
    // The card is its own bank login, so removing it leaves checking behind.
    bank.accounts = [{ ...account('acc-card', 'Sapphire', 'credit', 50000), mask: '4321' }]
    const { connectionId } = await linkBank(ctx, newLink('public-card'))
    expect((await filed())[CARD_PAYMENT]).toBe('Transfers')

    await removeConnection(ctx, connectionId)

    expect((await filed())[CARD_PAYMENT]).toBe('Debt payments')
  })

  it('turns earlier payments into transfers when a sync brings in the card they paid', async () => {
    const bank = new FakeBank()
    ctx.bank = bank
    await starterSet()
    bank.pages = [
      page({
        added: [
          bankTx({
            name: CARD_PAYMENT,
            amountCents: 200000,
            categoryPrimary: 'LOAN_PAYMENTS',
            categoryDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
          }),
        ],
      }),
    ]
    const { connectionId } = await linkBank(ctx, newLink('public-checking'))
    expect((await filed())[CARD_PAYMENT]).toBe('Debt payments')

    // The card shows up on a later sync with nothing new to download.
    bank.accounts.push({ ...account('acc-card', 'Sapphire', 'credit', 50000), mask: '4321' })
    await syncConnection(ctx, connectionId)

    expect((await filed())[CARD_PAYMENT]).toBe('Transfers')
  })
})

describe('what transfers do to totals', () => {
  const settings = settingsSchema.parse({ timeZone: 'UTC' })
  const now = new Date('2026-11-17T18:00:00Z')

  it('counts a car payment and a Zelle sent as spending, a Zelle received as income, and no card payment as either', async () => {
    const ids = await starterSet()
    await checkingAndCard()
    const { accountId } = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-05',
      name: 'HYUNDAI MOTOR FIN PAYMENT',
      amountCents: 45000,
      primary: 'LOAN_PAYMENTS',
      detailed: 'LOAN_PAYMENTS_CAR_PAYMENT',
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-06',
      name: 'Zelle payment to JANE DOE JPM99b1c2d3e',
      amountCents: 4000,
      primary: 'TRANSFER_OUT',
      detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-07',
      name: 'Zelle payment from JANE DOE BACmmhq0yzbn',
      amountCents: -12500,
      primary: 'TRANSFER_IN',
      detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
    })
    await recategorize(ctx.db)

    const budget = await budgetSummary(ctx.db, settings, now)
    const row = (name: string) => budget.categories.find((c) => c.categoryId === ids.get(name))

    expect(row('Car payment')?.spentCents).toBe(45000)
    expect(row('Sent to people')?.spentCents).toBe(4000)
    expect(row('Received from people')?.spentCents).toBe(12500)
    // The $2,000 card payment, on both sides, is in neither total.
    expect(budget.totals.incomeCents).toBe(12500)
    expect(budget.totals.uncategorizedCents).toBe(0)
    expect(budget.categories.find((c) => c.categoryId === ids.get('Transfers'))).toBeUndefined()
  })

  it('never takes a regular card payment arriving on the card for a paycheck', async () => {
    await starterSet()
    const card = await insertBankAccount(ctx.db, { type: 'credit' })
    // Four monthly payments arriving on the card, each money in.
    for (const date of ['2026-08-02', '2026-09-02', '2026-10-02', '2026-11-02']) {
      await insertBankTransaction(ctx.db, card.accountId, {
        date,
        name: 'Payment Thank You-Mobile',
        amountCents: -200000,
        primary: 'LOAN_PAYMENTS',
        detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      })
    }
    await recategorize(ctx.db)

    const payday = await nextPayday(ctx.db, settings, '2026-11-17')

    expect(payday.source).toBe('period_end')
  })
})

describe('payments between people in the transaction list', () => {
  it('reads who paid whom from the amount, with the name from the description', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-07',
      name: 'Zelle payment from JANE DOE BACmmhq0yzbn',
      amountCents: -12500,
      primary: 'TRANSFER_IN',
      detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-06',
      name: 'Zelle payment to JANE DOE JPM99b1c2d3e',
      amountCents: 4000,
      primary: 'TRANSFER_OUT',
      detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-05',
      name: 'KING SOOPERS',
      amountCents: 8000,
      primary: 'FOOD_AND_DRINK',
      detailed: 'FOOD_AND_DRINK_GROCERIES',
    })

    const { transactions } = await call('list_transactions', {})

    expect(transactions.map((t) => [t.name, t.person])).toEqual([
      [
        'Zelle payment from JANE DOE BACmmhq0yzbn',
        { app: 'Zelle', direction: 'in', counterparty: 'Jane Doe' },
      ],
      [
        'Zelle payment to JANE DOE JPM99b1c2d3e',
        { app: 'Zelle', direction: 'out', counterparty: 'Jane Doe' },
      ],
      ['KING SOOPERS', null],
    ])
    // The bank codes stay internal; the list shows the most specific one only.
    expect(transactions[0]).not.toHaveProperty('providerCategoryDetailed')
    expect(transactions[0]?.bankCategory).toBe('TRANSFER_IN_ACCOUNT_TRANSFER')
  })
})
