import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { FLOW_PERIODS, moneyInAndOut, RECENT_COUNT } from '../src/domain/accountView.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-17, in UTC. The default budget period is the calendar month.
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

/** A category of this kind; returns its id. */
async function category(name: string, kind: 'expense' | 'income' | 'transfer') {
  const created = await call('create_category', { name, kind })
  return created.id
}

/** A transaction filed under a category. */
async function filed(
  accountId: string,
  date: string,
  name: string,
  amountCents: number,
  categoryId: string,
) {
  const id = await insertBankTransaction(ctx.db, accountId, { date, name, amountCents })
  await call('update_transaction', { id, categoryId })
}

describe('summarize_accounts', () => {
  it('summarizes nothing on a fresh install', async () => {
    const view = await call('summarize_accounts')
    expect(view).toMatchObject({
      accounts: [],
      allAccounts: true,
      period: { start: '2026-11-01', end: '2026-11-30' },
      spending: [],
      recent: [],
      alerts: [],
      summary: {
        headline: 'No accounts yet. Connect a bank or add one in Settings.',
        points: [],
      },
    })
    expect(view.flows).toHaveLength(FLOW_PERIODS)
  })

  it('narrows balances, flows, spending, transactions and alerts to the picked accounts', async () => {
    const groceries = await category('Groceries', 'expense')
    const pay = await category('Pay', 'income')
    const moves = await category('Moving money', 'transfer')
    const { accountId: everyday } = await insertBankAccount(ctx.db, {
      name: 'Everyday',
      balanceCents: -4210,
    })
    const { accountId: card } = await insertBankAccount(ctx.db, {
      name: 'Card',
      type: 'credit',
      balanceCents: 30000,
    })
    await ctx.db.query(`UPDATE accounts SET credit_limit_cents = 100000 WHERE id = $1`, [card])

    await filed(everyday, '2026-11-03', 'PAYROLL', -250000, pay)
    await filed(everyday, '2026-11-05', 'MARKET', 12000, groceries)
    await filed(everyday, '2026-10-20', 'MARKET', 9000, groceries)
    // A card payment is a transfer, left out of money in and out.
    await filed(everyday, '2026-11-06', 'CARD PAYMENT', 20000, moves)
    await filed(card, '2026-11-07', 'GROCER', 5000, groceries)
    await insertBankTransaction(ctx.db, everyday, {
      date: '2026-11-08',
      name: 'MYSTERY',
      amountCents: 700,
    })

    const view = await call('summarize_accounts', { accountIds: [everyday] })

    expect(view.allAccounts).toBe(false)
    expect(view.accounts.map((a) => a.name)).toEqual(['Test Everyday'])
    expect(view.balances).toMatchObject({ cashCents: -4210, owedCents: 0, cashAccounts: 1 })
    expect(view.flows.map((f) => [f.start, f.end, f.inCents, f.outCents])).toEqual([
      ['2026-08-01', '2026-08-31', 0, 0],
      ['2026-09-01', '2026-09-30', 0, 0],
      ['2026-10-01', '2026-10-31', 0, 9000],
      ['2026-11-01', '2026-11-30', 250000, 12700],
    ])
    expect(view.spending).toEqual([
      { categoryId: groceries, name: 'Groceries', color: expect.any(String), spentCents: 12000 },
      { categoryId: null, name: 'Needs a category', color: null, spentCents: 700 },
    ])
    expect(view.recent.map((t) => t.name)).toEqual([
      'MYSTERY',
      'CARD PAYMENT',
      'MARKET',
      'PAYROLL',
      'MARKET',
    ])
    expect(view.alerts.map((a) => a.kind)).toEqual(['overdrawn'])
    expect(view.summary.headline).toBe('Nothing is available in Test Everyday.')
    // No alert card sits beside a pick, so the summary says the overdraft in words.
    expect(view.summary.points[0]).toBe(view.alerts[0]!.message)
    expect(view.summary.points[0]).toMatch(/^Test Everyday is overdrawn by /)

    const both = await call('summarize_accounts', { accountIds: [everyday, card] })
    expect(both.allAccounts).toBe(true)
    expect(both.balances).toMatchObject({
      owedCents: 30000,
      creditLimitCents: 100000,
      creditLeftCents: 70000,
      netCents: -34210,
    })
    expect(both.spending[0]).toMatchObject({ name: 'Groceries', spentCents: 17000 })
  })

  it('counts a hidden account when it is picked, though budgets leave it out', async () => {
    const groceries = await category('Groceries', 'expense')
    const { accountId } = await insertBankAccount(ctx.db, { hidden: true })
    await filed(accountId, '2026-11-05', 'MARKET', 12000, groceries)

    const picked = await call('summarize_accounts', { accountIds: [accountId] })
    expect(picked.spending.map((s) => s.spentCents)).toEqual([12000])
    const budget = await call('get_budget')
    expect(budget.totals.spentCents).toBe(0)
  })

  it(`lists the newest ${RECENT_COUNT} transactions`, async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    for (let day = 1; day <= RECENT_COUNT + 2; day++) {
      const date = `2026-11-${String(day).padStart(2, '0')}`
      await insertBankTransaction(ctx.db, accountId, { date, name: `Day ${day}`, amountCents: 100 })
    }
    const view = await call('summarize_accounts')
    expect(view.recent).toHaveLength(RECENT_COUNT)
    expect(view.recent[0]!.name).toBe(`Day ${RECENT_COUNT + 2}`)
  })

  it('leaves pending transactions out of money in and out when the owner says so', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'PENDING',
      amountCents: 500,
      pending: true,
    })
    await call('update_settings', { includePending: false })
    const flows = await moneyInAndOut(ctx.db, [{ start: '2026-11-01', end: '2026-12-01' }], false, [
      accountId,
    ])
    expect(flows).toEqual([{ inCents: 0, outCents: 0 }])
    const counted = await moneyInAndOut(
      ctx.db,
      [{ start: '2026-11-01', end: '2026-12-01' }],
      true,
      [accountId],
    )
    expect(counted).toEqual([{ inCents: 0, outCents: 500 }])
  })
})

describe('the remembered pick of accounts', () => {
  it('saves the pick in settings, so every device shows the same one', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    expect((await call('get_settings')).accountSelection).toEqual([])
    const saved = await call('update_settings', { accountSelection: [accountId] })
    expect(saved.accountSelection).toEqual([accountId])
  })
})

describe('list_transactions for several accounts', () => {
  it('matches any of the accounts given', async () => {
    const { accountId: a } = await insertBankAccount(ctx.db)
    const { accountId: b } = await insertBankAccount(ctx.db)
    const { accountId: c } = await insertBankAccount(ctx.db)
    for (const [account, name] of [
      [a, 'A'],
      [b, 'B'],
      [c, 'C'],
    ] as const) {
      await insertBankTransaction(ctx.db, account, { date: '2026-11-05', name, amountCents: 100 })
    }
    const { transactions, total } = await call('list_transactions', { accountIds: [a, c] })
    expect(transactions.map((t) => t.name).sort()).toEqual(['A', 'C'])
    expect(total).toBe(2)
  })
})
