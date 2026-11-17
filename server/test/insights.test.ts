import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AnyAction } from '../src/actions/action.js'
import { runAction } from '../src/actions/action.js'
import { findAction } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { roundUpTidy } from '../src/domain/insights.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, input: unknown = {}): Promise<any> {
  return runAction(ctx, findAction(name) as AnyAction, input)
}

beforeAll(async () => {
  // Today is Nov 17, 2026; periods are calendar months.
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})

let accountId: string
let food: { id: string }
let rent: { id: string }

beforeEach(async () => {
  await resetData(ctx.db)
  accountId = (await insertBankAccount(ctx.db)).accountId
  food = await call('create_category', { name: 'Food', budgetCents: 60000 })
  rent = await call('create_category', { name: 'Rent', budgetCents: 150000, trackPace: false })
  await call('create_category', { name: 'Pay', kind: 'income' })
  await call('create_rule', {
    field: 'description',
    matchType: 'contains',
    pattern: 'grocer',
    categoryId: food.id,
  })
  await call('create_rule', {
    field: 'description',
    matchType: 'contains',
    pattern: 'rent',
    categoryId: rent.id,
  })
})

async function spend(date: string, name: string, amountCents: number, merchantName?: string) {
  await insertBankTransaction(ctx.db, accountId, { date, name, amountCents, merchantName })
}

async function recategorize() {
  // Rules apply on sync; inserting directly skips that, so reapply them.
  await call('reorder_rules', { ids: (await call('list_rules')).map((r: { id: string }) => r.id) })
}

describe('insights', () => {
  it('compares this period with the same point last period', async () => {
    await spend('2026-10-05', 'Grocer A', 10000)
    await spend('2026-10-25', 'Grocer B', 20000)
    await spend('2026-11-03', 'Grocer C', 15000)
    await recategorize()
    const budget = await call('get_budget')
    expect(budget.totals.spentCents).toBe(15000)
    expect(budget.previous).toEqual({ spentCents: 30000, spentToDateCents: 10000 })
  })

  it('reports spending and income per period, oldest first', async () => {
    await spend('2026-09-10', 'Grocer', 5000)
    await spend('2026-10-01', 'Rent', 150000)
    await spend('2026-10-15', 'Paycheck', -300000)
    await recategorize()
    const periods = await call('get_trends', { periods: 3 })
    expect(periods.map((p: { start: string }) => p.start)).toEqual([
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ])
    expect(periods[0]).toMatchObject({ spentCents: 5000, incomeCents: 0, end: '2026-09-30' })
    // The paycheck is uncategorized here, so it counts as negative spending.
    expect(periods[1]).toMatchObject({ spentCents: 150000 - 300000 })
  })

  it('counts an income category as income and leaves transfers out of trends', async () => {
    const pay = (await call('list_categories')).find((c: { name: string }) => c.name === 'Pay')
    const transfers = await call('create_category', { name: 'Transfers', kind: 'transfer' })
    await call('create_rule', { pattern: 'paycheck', field: 'description', categoryId: pay.id })
    await call('create_rule', {
      pattern: 'card payment',
      field: 'description',
      categoryId: transfers.id,
    })
    await spend('2026-11-01', 'Paycheck', -300000)
    await spend('2026-11-02', 'Grocer', 4000)
    await spend('2026-11-03', 'Card payment', 90000)
    await recategorize()

    const [current] = (await call('get_trends', { periods: 2 })).slice(-1)

    expect(current).toMatchObject({ spentCents: 4000, incomeCents: 300000 })
    expect(current.categories.map((c: { categoryId: string }) => c.categoryId)).not.toContain(
      transfers.id,
    )
  })

  it('suggests tidy monthly budgets from the last three full months', async () => {
    for (const date of ['2026-08-02', '2026-09-02', '2026-10-02'])
      await spend(date, 'Grocer', 41234)
    await spend('2026-11-02', 'Grocer', 99999) // this month is not counted
    await recategorize()
    const { from, to, suggestions } = await call('suggest_budgets')
    expect({ from, to }).toEqual({ from: '2026-08-02', to: '2026-10-31' })
    const foodSuggestion = suggestions.find((s: { name: string }) => s.name === 'Food')
    // History starts Aug 2, so 91 days of data: 123,702 / 91 days * 30.44 a month.
    expect(foodSuggestion.averageMonthlyCents).toBe(Math.round((123702 / 91) * (365.25 / 12)))
    expect(foodSuggestion.suggestedMonthlyCents).toBe(
      roundUpTidy(foodSuggestion.averageMonthlyCents),
    )
  })

  it('suggests budgets for starter categories before they exist', async () => {
    const bank = (date: string, name: string, cents: number, primary: string) =>
      insertBankTransaction(ctx.db, accountId, { date, name, amountCents: cents, primary })
    for (const date of ['2026-08-02', '2026-09-02', '2026-10-02']) {
      await bank(date, 'Cafe', 9100, 'FOOD_AND_DRINK')
      await bank(date, 'Payroll', -300000, 'INCOME')
    }
    const starter = (name: string, kind: string, providerCategories: string[]) => ({
      name,
      kind,
      providerCategories,
    })
    const result = await call('suggest_starter_budgets', {
      categories: [
        starter('Eating out', 'expense', ['FOOD_AND_DRINK']),
        starter('Pay', 'income', ['INCOME']),
        starter('Travel', 'expense', ['TRAVEL']),
      ],
    })
    // Only expense categories with spending get a number; 27,300 over 91 days.
    expect(result).toEqual([
      {
        name: 'Eating out',
        averageMonthlyCents: Math.round((27300 / 91) * (365.25 / 12)),
        suggestedMonthlyCents: roundUpTidy(Math.round((27300 / 91) * (365.25 / 12))),
      },
    ])
  })

  it('rounds suggestions up to tidy amounts', () => {
    expect(roundUpTidy(4210)).toBe(4500)
    expect(roundUpTidy(41234)).toBe(42000)
    expect(roundUpTidy(123456)).toBe(125000)
  })

  it('ranks merchants by spending, net of refunds', async () => {
    await spend('2026-11-02', 'Grocer 1', 5000, 'King Soopers')
    await spend('2026-11-04', 'Grocer 2', 7000, 'King Soopers')
    await spend('2026-11-05', 'Grocer 3', 9000, 'Whole Foods')
    await spend('2026-11-06', 'Refund', -9000, 'Whole Foods')
    await recategorize()
    expect(await call('top_merchants')).toEqual([
      { merchant: 'King Soopers', spentCents: 12000, count: 2 },
    ])
  })

  it('tracks flexible spending day by day, leaving out bills', async () => {
    await spend('2026-11-01', 'Rent', 150000)
    await spend('2026-11-02', 'Grocer', 3000)
    await spend('2026-11-10', 'Grocer', 5000)
    await recategorize()
    const pace = await call('get_spending_pace')
    expect(pace).toMatchObject({ categoryIds: [food.id], budgetCents: 60000, days: 30 })
    expect(pace.cumulative).toHaveLength(17)
    expect(pace.cumulative[0]).toEqual({ date: '2026-11-01', cents: 0 })
    expect(pace.cumulative.at(-1)).toEqual({ date: '2026-11-17', cents: 8000 })
    expect(pace.projectedCents).toBe(Math.round((8000 / 17) * 30))
  })
})

describe('rule preview', () => {
  it('counts what a new rule would move, leaving hand-picked ones alone', async () => {
    await spend('2026-11-02', 'Costco 1', 5000)
    await spend('2026-11-03', 'Costco 2', 6000)
    await spend('2026-11-04', 'Costco 3', 7000)
    await recategorize()
    const { transactions } = await call('list_transactions', { search: 'Costco 3' })
    await call('categorize_transactions', { ids: [transactions[0].id], categoryId: rent.id })

    const preview = await call('preview_rule', {
      field: 'description',
      matchType: 'starts_with',
      pattern: 'costco',
      categoryId: food.id,
    })
    expect(preview).toMatchObject({
      matchCount: 3,
      wouldMove: 2,
      movingFrom: [{ categoryId: null, count: 2 }],
    })
  })
})

describe('insights with little or no history', () => {
  it('suggests nothing before there are any transactions', async () => {
    expect((await call('suggest_budgets')).suggestions).toEqual([])
    expect(await call('suggest_starter_budgets', { categories: [{ name: 'Groceries' }] })).toEqual(
      [],
    )
  })

  it('shows a past period whole, through its last day', async () => {
    await spend('2026-10-05', 'Grocer', 2000)
    await recategorize()
    const pace = await call('get_spending_pace', { offset: -1 })
    expect(pace).toMatchObject({ start: '2026-10-01', end: '2026-10-31', days: 31 })
    expect(pace.cumulative).toHaveLength(31)
    expect(pace.cumulative.at(-1)).toEqual({ date: '2026-10-31', cents: 2000 })
    expect(pace.projectedCents).toBe(2000)
  })

  it('projects nothing for a period that has not started', async () => {
    const pace = await call('get_spending_pace', { offset: 1 })
    expect(pace).toMatchObject({ start: '2026-12-01', cumulative: [], projectedCents: 0 })
  })
})
