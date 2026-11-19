// A transfer between the owner's own accounts moves no total: spending,
// income, budgets, trends, cash flow, account flows, merchants, the check-in
// and the summary all read the same with a paired transfer as without one.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { categoryInputSchema, createCategory, listCategories } from '../src/domain/categories.js'
import { recategorize } from '../src/domain/categorize.js'
import {
  countedSql,
  countsAsSpending,
  countsTowardTotals,
  isInternalTransfer,
  spendingSql,
} from '../src/domain/counted.js'
import { STARTER_CATEGORIES } from '../src/domain/starters.js'
import { actionCaller } from './actionCaller.js'
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
})

async function starterSet(): Promise<Map<string, string>> {
  for (const { formerly: _formerly, ...category } of STARTER_CATEGORIES) {
    await createCategory(ctx.db, category)
  }
  return new Map((await listCategories(ctx.db)).map((c) => [c.name, c.id]))
}

/** Checking, savings and a card, with a paycheck, groceries and a monthly charge. */
async function everydayMoney() {
  const checking = await insertBankAccount(ctx.db, { name: 'Total Checking' })
  const savings = await insertBankAccount(ctx.db, { name: 'Savings' })
  const card = await insertBankAccount(ctx.db, { name: 'Sapphire', type: 'credit' })
  await insertBankTransaction(ctx.db, checking.accountId, {
    date: '2026-11-03',
    name: 'ACME PAYROLL',
    amountCents: -300000,
    primary: 'INCOME',
    detailed: 'INCOME_WAGES',
  })
  await insertBankTransaction(ctx.db, card.accountId, {
    date: '2026-11-05',
    name: 'KING SOOPERS #12',
    amountCents: 8400,
    primary: 'FOOD_AND_DRINK',
    detailed: 'FOOD_AND_DRINK_GROCERIES',
  })
  for (const date of ['2026-09-08', '2026-10-08', '2026-11-08']) {
    await insertBankTransaction(ctx.db, card.accountId, {
      date,
      name: 'NETFLIX.COM',
      amountCents: 1599,
      primary: 'ENTERTAINMENT',
      detailed: 'ENTERTAINMENT_TV_AND_MOVIES',
    })
  }
  return { checking, savings, card }
}

/**
 * Two transfers as banks often send them, with no category codes at all (as
 * from a file): checking to savings, and a card payment out of checking with
 * its arrival on the card.
 */
async function transfers({ checking, savings, card }: Awaited<ReturnType<typeof everydayMoney>>) {
  const ids = [
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-11-10',
      name: 'ONLINE TRANSFER TO SAV ...4417 TRANSACTION#: 31677311100 11/10',
      amountCents: 50000,
    }),
    await insertBankTransaction(ctx.db, savings.accountId, {
      date: '2026-11-11',
      name: 'ONLINE TRANSFER FROM CHK ...9921',
      amountCents: -50000,
    }),
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-11-12',
      name: 'CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224',
      amountCents: 8400,
    }),
    await insertBankTransaction(ctx.db, card.accountId, {
      date: '2026-11-13',
      name: 'PAYMENT THANK YOU',
      amountCents: -8400,
    }),
  ]
  await recategorize(ctx.db)
  return ids
}

/** Every total Leeway shows or hands an assistant, as one comparable object. */
async function everyTotal() {
  const budget = await call('get_budget', {})
  const accounts = await call('summarize_accounts', {})
  return {
    budget: { totals: budget.totals, categories: budget.categories, alerts: budget.alerts },
    trends: await call('get_trends', {}),
    merchants: await call('top_merchants', {}),
    pace: await call('get_spending_pace', {}),
    cashFlow: await call('get_cash_flow', {}),
    recurring: await call('find_recurring', {}),
    checkin: await call('get_checkin', {}),
    summary: (await call('get_summary', {})).headline,
    accounts: { flows: accounts.flows, spending: accounts.spending, summary: accounts.summary },
  }
}

describe('a paired transfer moves no totals', () => {
  it('reads every total the same with two paired transfers as without them', async () => {
    await starterSet()
    const accounts = await everydayMoney()
    await recategorize(ctx.db)
    const before = await everyTotal()
    expect(before.budget.totals.spentCents).toBe(8400 + 1599)
    expect(before.budget.totals.incomeCents).toBe(300000)

    await transfers(accounts)
    expect(await everyTotal()).toEqual(before)
  })

  it('files both sides of each pair under Transfers', async () => {
    await starterSet()
    await transfers(await everydayMoney())
    const { rows } = await ctx.db.query<{ category: string; source: string }>(
      `SELECT c.name AS category, t.category_source AS source FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.name ~ 'TRANSFER|AUTOPAY|THANK YOU' ORDER BY t.date`,
    )
    expect(rows).toEqual(Array(4).fill({ category: 'Transfers', source: 'provider' }))
  })
})

describe('a pair with no transfer category to go to', () => {
  /** A card payment, both sides, that Bills also claims; filed after. */
  async function cardPayment() {
    await createCategory(
      ctx.db,
      categoryInputSchema.parse({ name: 'Bills', providerCategories: ['LOAN_PAYMENTS'] }),
    )
    const checking = await insertBankAccount(ctx.db)
    const card = await insertBankAccount(ctx.db, { name: 'Sapphire', type: 'credit' })
    for (const [accountId, amountCents] of [
      [checking.accountId, 8400],
      [card.accountId, -8400],
    ] as const) {
      await insertBankTransaction(ctx.db, accountId, {
        date: '2026-11-12',
        name: 'CARD PAYMENT',
        amountCents,
        primary: 'LOAN_PAYMENTS',
        detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      })
    }
    await recategorize(ctx.db)
    const { rows } = await ctx.db.query<{ category: string | null; kind: string | null }>(
      `SELECT c.name AS category, c.kind FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id`,
    )
    return rows
  }

  it('makes a transfer category from the starter, never filing the pair as spending', async () => {
    const filed = await cardPayment()
    expect(filed).toEqual([
      { category: 'Transfers', kind: 'transfer' },
      { category: 'Transfers', kind: 'transfer' },
    ])
    const made = (await listCategories(ctx.db)).find((category) => category.kind === 'transfer')
    expect(made).toMatchObject({ icon: 'swap', group: 'Transfers' })
  })

  it('gives the category it makes another name when Transfers is taken', async () => {
    await createCategory(ctx.db, categoryInputSchema.parse({ name: 'transfers' }))
    expect(await cardPayment()).toEqual([
      { category: 'Transfers between accounts', kind: 'transfer' },
      { category: 'Transfers between accounts', kind: 'transfer' },
    ])
  })

  it('leaves the pair uncategorized when every name is taken', async () => {
    await createCategory(ctx.db, categoryInputSchema.parse({ name: 'Transfers' }))
    await createCategory(ctx.db, categoryInputSchema.parse({ name: 'Transfers between accounts' }))
    expect(await cardPayment()).toEqual([
      { category: null, kind: null },
      { category: null, kind: null },
    ])
  })

  it('makes none when nothing pairs', async () => {
    await recategorize(ctx.db)
    expect(await listCategories(ctx.db)).toEqual([])
  })
})

describe('the counts-toward-totals predicate', () => {
  it('leaves only transfers out of totals, and counts uncategorized spending', () => {
    expect(isInternalTransfer('transfer')).toBe(true)
    expect(countsTowardTotals('transfer')).toBe(false)
    expect(countsTowardTotals('expense')).toBe(true)
    expect(countsTowardTotals(null)).toBe(true)
    expect(countsAsSpending('expense')).toBe(true)
    expect(countsAsSpending(null)).toBe(true)
    expect(countsAsSpending('income')).toBe(false)
    expect(countsAsSpending(undefined)).toBe(false)
  })

  it('says the same in SQL', () => {
    expect(countedSql()).toBe("(c.kind IS NULL OR c.kind <> 'transfer')")
    expect(spendingSql('cat')).toBe("(cat.kind IS NULL OR cat.kind = 'expense')")
  })
})
