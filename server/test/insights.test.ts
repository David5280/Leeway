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

/** Adds a purchase with the code Plaid gives every one, which no rule here reads. */
async function spend(date: string, name: string, amountCents: number, merchantName?: string) {
  const detailed = 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE'
  await insertBankTransaction(ctx.db, accountId, {
    date,
    name,
    amountCents,
    merchantName,
    detailed,
  })
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
    expect(budget.previous).toEqual({
      spentCents: 30000,
      spentToDateCents: 10000,
      categories: [{ categoryId: food.id, spentToDateCents: 10000 }],
    })
  })

  it("reads each category's last period to date as its row reads, money received as positive", async () => {
    const pay = (await call('list_categories')).find((c: { name: string }) => c.name === 'Pay')
    await spend('2026-10-02', 'Paycheck', -250000)
    await spend('2026-10-03', 'Corner store', 700)
    await ctx.db.query(`UPDATE transactions SET category_id = $1 WHERE name = 'Paycheck'`, [pay.id])
    const budget = await call('get_budget')
    // Uncategorized spending counts toward the total, but has no category row to compare.
    expect(budget.previous.categories).toEqual([{ categoryId: pay.id, spentToDateCents: 250000 }])
    expect(budget.previous.spentToDateCents).toBe(700)
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

  it('adds up a merchant’s stores as one, named as everywhere else, the biggest first', async () => {
    await spend('2026-11-02', 'STARBUCKS #12345 DENVER CO', 500)
    await spend('2026-11-03', 'STARBUCKS #67890 AURORA CO', 700)
    await spend('2026-11-04', 'SQ *BLUE BOTTLE #12', 1200)
    await spend('2026-11-05', 'SQ *BLUE BOTTLE #12', 400)
    await spend('2026-11-05', 'PEETS COFFEE #77', 1200)
    await spend('2026-11-06', 'APPLE.COM/BILL 866-712-7753 CA', 99)
    await spend('2026-11-06', 'APPLE.COM/BILL 866-712-7753 CA', -99)
    await recategorize()
    // Two words that could be a person's, with no merchant id from Plaid, are labelled for a model.
    expect(await call('top_merchants', { limit: 1 })).toEqual([
      { merchant: 'Blue Bottle', spentCents: 1600, count: 2, modelLabel: 'Purchase or payment' },
    ])
    expect(await call('top_merchants')).toEqual([
      { merchant: 'Blue Bottle', spentCents: 1600, count: 2, modelLabel: 'Purchase or payment' },
      { merchant: 'Peets Coffee', spentCents: 1200, count: 1 },
      { merchant: 'Starbucks', spentCents: 1200, count: 2 },
    ])
  })

  it('leaves out lines with no readable merchant, rather than add them up as one', async () => {
    await spend('2026-11-02', 'XXXXXX4417 11/18', 90000)
    await spend('2026-11-03', '123456789', 80000)
    await spend('2026-11-04', 'CORNER STORE', 700)
    await recategorize()
    expect(await call('top_merchants')).toEqual([
      { merchant: 'Corner Store', spentCents: 700, count: 1 },
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

describe('payments that could be between people', () => {
  const ACCOUNT_TRANSFER = 'TRANSFER_OUT_ACCOUNT_TRANSFER'

  /** Adds a transaction with Plaid's merchant and code, as a sync would. */
  async function bank(date: string, name: string, amountCents: number, more = {}) {
    await insertBankTransaction(ctx.db, accountId, { date, name, amountCents, ...more })
  }

  it('are totalled apart from a shop of the same name, with the label a model sees', async () => {
    await bank('2026-11-03', 'Zelle payment to ROSALIND FAIRWEATHER', 2_500)
    await bank('2026-11-04', 'SQ *ROSALIND FAIRWEATHER', 4_000, {
      merchantName: 'Rosalind Fairweather',
      detailed: 'FOOD_AND_DRINK_BAKERIES',
    })
    await bank('2026-11-05', 'PAYPAL INST XFER', 3_000, {
      merchantName: 'Clara',
      detailed: ACCOUNT_TRANSFER,
    })
    await recategorize()
    // A sole trader by name is labelled for the model too, though the owner sees the name.
    expect(await call('top_merchants')).toEqual([
      {
        merchant: 'Rosalind Fairweather',
        spentCents: 4_000,
        count: 1,
        modelLabel: 'Purchase or payment',
      },
      { merchant: 'Clara', spentCents: 3_000, count: 1, modelLabel: 'PayPal payment (sent)' },
      {
        merchant: 'Zelle payment to Rosalind Fairweather',
        spentCents: 2_500,
        count: 1,
        modelLabel: 'Zelle payment (sent)',
      },
    ])
  })

  it('repeat as a series named as people, with its label, beside a shop that has none', async () => {
    for (const month of ['08', '09', '10', '11']) {
      await bank(`2026-${month}-05`, 'Zelle payment to CLARA JPM99A1B2C3', 20_000)
      await bank(`2026-${month}-06`, 'NETFLIX.COM', 1_599, {
        merchantName: 'Netflix',
        detailed: 'ENTERTAINMENT_TV_AND_MOVIES',
      })
    }
    const found = (await call('find_recurring')) as { name: string; modelLabel?: string }[]
    expect(found.map(({ name, modelLabel }) => ({ name, modelLabel }))).toEqual([
      { name: 'Zelle payment to Clara', modelLabel: 'Zelle payment (sent)' },
      { name: 'Netflix', modelLabel: undefined },
    ])
  })

  it('keep a bank transfer apart, totalled and repeating with its label', async () => {
    for (const month of ['08', '09', '10', '11']) {
      await bank(`2026-${month}-05`, 'Online Transfer to Pellworth Oda', 90_000, {
        detailed: ACCOUNT_TRANSFER,
      })
    }
    await recategorize()
    const label = { modelLabel: 'Transfer to another account' }
    expect(await call('top_merchants')).toEqual([
      { merchant: 'Transfer to Pellworth Oda', spentCents: 90_000, count: 1, ...label },
    ])
    expect(await call('find_recurring')).toEqual([
      expect.objectContaining({ name: 'Transfer to Pellworth Oda', ...label }),
    ])
  })

  it('label a line with no code that is no shop the owner buys from, unless typed in', async () => {
    await bank('2026-11-06', 'JANE PRYCEWOOD', 1_000)
    await ctx.db.query(
      `INSERT INTO transactions (account_id, date, name, amount_cents) VALUES ($1, '2026-11-07', 'Farmers market', 800)`,
      [accountId],
    )
    await recategorize()
    expect(await call('top_merchants')).toEqual([
      {
        merchant: 'Jane Prycewood',
        spentCents: 1_000,
        count: 1,
        modelLabel: 'Purchase or payment',
      },
      { merchant: 'Farmers market', spentCents: 800, count: 1 },
    ])
  })
})
