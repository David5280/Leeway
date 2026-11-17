import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AnyAction } from '../src/actions/action.js'
import { runAction } from '../src/actions/action.js'
import { findAction } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { AppError } from '../src/errors.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, input: unknown = {}): Promise<any> {
  const action = findAction(name) as AnyAction
  expect(action, `action ${name}`).toBeDefined()
  return runAction(ctx, action, input)
}

async function callError(name: string, input: unknown = {}): Promise<AppError> {
  try {
    await call(name, input)
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error(`${name} did not fail`)
}

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

describe('settings', () => {
  it('starts with complete defaults', async () => {
    const settings = await call('get_settings')
    expect(settings).toMatchObject({
      period: { kind: 'monthly', startDay: 1 },
      currency: 'USD',
      appearance: { theme: 'night', density: 'comfortable' },
    })
    expect(settings.dashboard.widgets.length).toBeGreaterThan(0)
  })

  it('merges appearance and replaces the period', async () => {
    await call('update_settings', { appearance: { theme: 'neon' } })
    const updated = await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-27' },
      appearance: { corners: 'square', accent: '#ff8800' },
    })
    expect(updated.appearance).toMatchObject({
      theme: 'neon',
      corners: 'square',
      accent: '#ff8800',
    })
    expect(updated.period).toEqual({
      kind: 'paycheck',
      frequency: 'biweekly',
      anchorDate: '2026-11-27',
      semimonthlyDays: [1, 15],
    })
  })

  it('rejects unknown fields and bad values with a readable message', async () => {
    const error = await callError('update_settings', { timeZone: 'Mars/Olympus' })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('Unknown time zone')
    expect((await callError('update_settings', { colour: 'red' })).code).toBe('invalid_input')
    const twice = { type: 'recent', size: 'wide', visible: true }
    const duplicate = await callError('update_settings', { dashboard: { widgets: [twice, twice] } })
    expect(duplicate.message).toContain('only appear once')
  })

  it('keeps valid appearance options when a stored one no longer exists', async () => {
    await ctx.db.query(
      `UPDATE settings SET data = '{"appearance": {"theme": "harbor", "font": "comic-sans"}}'`,
    )
    const settings = await call('get_settings')
    expect(settings.appearance).toMatchObject({ theme: 'harbor', font: 'theme' })
  })
})

describe('categories', () => {
  it('creates, updates, reorders and deletes', async () => {
    const food = await call('create_category', { name: 'Food', budgetCents: 50000 })
    const fun = await call('create_category', { name: 'Fun' })
    expect(food).toMatchObject({
      name: 'Food',
      kind: 'expense',
      budgetCadence: 'month',
      position: 0,
    })
    expect(fun.position).toBe(1)

    const updated = await call('update_category', { id: food.id, budgetCents: 55000 })
    expect(updated).toMatchObject({ name: 'Food', budgetCents: 55000 })

    const reordered = await call('reorder_categories', { ids: [fun.id, food.id] })
    expect(reordered.map((c: { name: string }) => c.name)).toEqual(['Fun', 'Food'])

    await call('delete_category', { id: fun.id })
    expect(await call('list_categories')).toHaveLength(1)
    expect((await callError('delete_category', { id: fun.id })).code).toBe('not_found')
  })

  it('refuses a duplicate name, ignoring case', async () => {
    await call('create_category', { name: 'Food' })
    const error = await callError('create_category', { name: 'food' })
    expect(error.code).toBe('conflict')
  })
})

describe('categorization', () => {
  it('maps bank categories, lets rules win, and keeps manual picks', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const groceries = await call('create_category', {
      name: 'Groceries',
      providerCategories: ['FOOD_AND_DRINK_GROCERIES'],
    })
    const dining = await call('create_category', {
      name: 'Dining',
      providerCategories: ['FOOD_AND_DRINK'],
    })
    const coffee = await call('create_category', { name: 'Coffee' })

    const kingSoopers = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'KING SOOPERS #12',
      merchantName: 'King Soopers',
      amountCents: 8400,
      primary: 'FOOD_AND_DRINK',
      detailed: 'FOOD_AND_DRINK_GROCERIES',
    })
    const starbucks = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-11',
      name: 'STARBUCKS 123',
      merchantName: 'Starbucks',
      amountCents: 650,
      primary: 'FOOD_AND_DRINK',
      detailed: 'FOOD_AND_DRINK_COFFEE',
    })

    // A rule recategorizes existing transactions right away.
    const { recategorized } = await call('create_rule', {
      pattern: 'starbucks',
      categoryId: coffee.id,
    })
    expect(recategorized).toBe(2)

    const byId = async () => {
      const { transactions } = await call('list_transactions')
      return Object.fromEntries(transactions.map((t: { id: string }) => [t.id, t])) as Record<
        string,
        { categoryId: string; categorySource: string }
      >
    }
    let txs = await byId()
    expect(txs[kingSoopers]).toMatchObject({ categoryId: groceries.id, categorySource: 'provider' })
    expect(txs[starbucks]).toMatchObject({ categoryId: coffee.id, categorySource: 'rule' })

    // A manual pick sticks even when the rules change.
    await call('update_transaction', { id: starbucks, categoryId: dining.id })
    await call('create_rule', { pattern: 'starbucks', categoryId: groceries.id })
    txs = await byId()
    expect(txs[starbucks]).toMatchObject({ categoryId: dining.id, categorySource: 'manual' })

    // Clearing it hands the transaction back to the rules (the newest rule now wins).
    await call('update_transaction', { id: starbucks, categoryId: null })
    txs = await byId()
    expect(txs[starbucks]).toMatchObject({ categoryId: groceries.id, categorySource: 'rule' })

    // Deleting a category sends its transactions back to the bank mapping.
    await call('delete_category', { id: groceries.id })
    txs = await byId()
    expect(txs[kingSoopers]).toMatchObject({ categoryId: dining.id, categorySource: 'provider' })
  })

  it('respects rule amount bounds and previews matches', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const big = await call('create_category', { name: 'Big Amazon' })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-01',
      name: 'AMAZON MKTP',
      amountCents: 2000,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-02',
      name: 'AMAZON MKTP',
      amountCents: 15000,
    })

    const preview = await call('preview_rule', { pattern: 'amazon', minAmountCents: 10000 })
    expect(preview.matchCount).toBe(1)

    expect(
      (
        await callError('create_rule', {
          pattern: 'amazon',
          categoryId: big.id,
          minAmountCents: 500,
          maxAmountCents: 100,
        })
      ).code,
    ).toBe('invalid_input')

    await call('create_rule', { pattern: 'amazon', categoryId: big.id, minAmountCents: 10000 })
    const { transactions } = await call('list_transactions', { categoryId: big.id })
    expect(transactions).toHaveLength(1)
    expect(transactions[0].amountCents).toBe(15000)
  })

  it('categorizes many transactions at once', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const travel = await call('create_category', { name: 'Travel' })
    const ids = [
      await insertBankTransaction(ctx.db, accountId, {
        date: '2026-11-01',
        name: 'UNITED',
        amountCents: 30000,
      }),
      await insertBankTransaction(ctx.db, accountId, {
        date: '2026-11-02',
        name: 'HILTON',
        amountCents: 40000,
      }),
    ]
    expect(await call('categorize_transactions', { ids, categoryId: travel.id })).toEqual({
      updated: 2,
    })
    const { total } = await call('list_transactions', { categoryId: travel.id })
    expect(total).toBe(2)
  })
})

describe('transactions', () => {
  it('filters by date, text, category and amount, newest first', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-10-30',
      name: 'Old',
      amountCents: 100,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-05',
      name: 'Target',
      amountCents: 5000,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-06',
      name: 'Paycheck',
      amountCents: -200000,
    })

    const november = await call('list_transactions', { start: '2026-11-01', end: '2026-11-30' })
    expect(november.transactions.map((t: { name: string }) => t.name)).toEqual([
      'Paycheck',
      'Target',
    ])
    expect((await call('list_transactions', { search: 'targ' })).total).toBe(1)
    expect((await call('list_transactions', { categoryId: 'uncategorized' })).total).toBe(3)
    expect((await call('list_transactions', { minAmountCents: 1000 })).total).toBe(1)
    expect((await call('list_transactions', { search: '100%' })).total).toBe(0)
  })

  it('lets bank transactions be noted or excluded but not rewritten', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const id = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-05',
      name: 'Dupe',
      amountCents: 5000,
    })
    const updated = await call('update_transaction', { id, note: 'charged twice', excluded: true })
    expect(updated).toMatchObject({ note: 'charged twice', excluded: true })
    expect((await call('list_transactions')).total).toBe(0)
    expect((await call('list_transactions', { includeExcluded: true })).total).toBe(1)
    expect((await callError('update_transaction', { id, amountCents: 1 })).code).toBe(
      'invalid_input',
    )
    expect((await callError('delete_transaction', { id })).code).toBe('invalid_input')
  })

  it('records cash spending by hand on a manual account', async () => {
    const wallet = await call('create_account', {
      name: 'Wallet',
      type: 'depository',
      balanceCents: 4000,
    })
    const food = await call('create_category', { name: 'Food' })
    await call('create_rule', { pattern: 'taco', categoryId: food.id })
    const tx = await call('create_transaction', {
      accountId: wallet.id,
      date: '2026-11-16',
      name: 'Taco truck',
      amountCents: 1200,
    })
    expect(tx).toMatchObject({ manual: true, categoryId: food.id, categorySource: 'rule' })
    const edited = await call('update_transaction', { id: tx.id, amountCents: 1500 })
    expect(edited.amountCents).toBe(1500)
    await call('delete_transaction', { id: tx.id })
    expect((await call('list_transactions')).total).toBe(0)
  })
})

describe('accounts', () => {
  it('lets bank accounts be renamed or hidden, but only manual ones edited', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'TOTAL CHECKING' })
    const renamed = await call('update_account', {
      id: accountId,
      displayName: 'Bills',
      hidden: true,
    })
    expect(renamed).toMatchObject({
      name: 'Bills',
      bankName: 'TOTAL CHECKING',
      hidden: true,
      manual: false,
    })
    expect((await call('list_accounts', { includeHidden: false })).length).toBe(0)
    expect((await callError('update_account', { id: accountId, balanceCents: 1 })).code).toBe(
      'invalid_input',
    )
    expect((await callError('delete_account', { id: accountId })).code).toBe('invalid_input')

    const car = await call('create_account', {
      name: 'Car loan',
      type: 'loan',
      balanceCents: 1200000,
    })
    const paid = await call('update_account', { id: car.id, balanceCents: 1150000 })
    expect(paid).toMatchObject({ manual: true, balanceCents: 1150000 })
    await call('delete_account', { id: car.id })
  })
})

describe('budget', () => {
  it('sums the current period from real transactions', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const hidden = await insertBankAccount(ctx.db, { name: 'Business card', hidden: true })
    const food = await call('create_category', { name: 'Food', budgetCents: 40000 })
    const transfers = await call('create_category', { name: 'Transfers', kind: 'transfer' })
    await call('create_rule', { pattern: 'grocer', categoryId: food.id })
    await call('create_rule', { pattern: 'payment', categoryId: transfers.id })

    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-03',
      name: 'Grocer',
      amountCents: 12000,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'Grocer',
      amountCents: 9000,
      pending: true,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-11',
      name: 'Grocer refund',
      amountCents: -1000,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-10-31',
      name: 'Grocer',
      amountCents: 7000,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-12',
      name: 'Card payment',
      amountCents: 50000,
    })
    await insertBankTransaction(ctx.db, hidden.accountId, {
      date: '2026-11-12',
      name: 'Grocer',
      amountCents: 99999,
    })
    await call('create_rule', { pattern: 'refund', categoryId: food.id })

    const budget = await call('get_budget')
    const row = budget.categories.find((c: { name: string }) => c.name === 'Food')
    expect(row).toMatchObject({ budgetCents: 40000, spentCents: 20000, leftCents: 20000 })
    expect(budget.totals.spentCents).toBe(20000)

    await call('update_settings', { includePending: false })
    const withoutPending = await call('get_budget')
    expect(withoutPending.totals.spentCents).toBe(11000)

    const october = await call('get_budget', { offset: -1 })
    expect(october.period.start).toBe('2026-10-01')
    expect(october.totals.spentCents).toBe(7000)
  })
})

describe('agent tokens', () => {
  it('shows a token once and stores only its hash', async () => {
    const created = await call('create_token', { name: 'Claude', scope: 'write' })
    expect(created.token).toMatch(/^lw_/)
    const [listed] = await call('list_tokens')
    expect(listed).toMatchObject({ name: 'Claude', scope: 'write' })
    expect(listed.token).toBeUndefined()
    const { rows } = await ctx.db.query('SELECT token_hash FROM api_tokens')
    expect(rows[0].token_hash).not.toContain(created.token)
  })
})
