import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { dailyBalances, recentBalances, RECENT_BALANCE_DAYS } from '../src/domain/recentBalances.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

describe('dailyBalances', () => {
  const changes = [
    { day: '2026-11-01', balanceCents: 100 },
    { day: '2026-11-03', balanceCents: 250 },
  ]

  it('carries each change forward to the days after it', () => {
    expect(dailyBalances(changes, '2026-11-01', '2026-11-05')).toEqual([100, 100, 250, 250, 250])
  })

  it('opens on the last change before the first day', () => {
    expect(dailyBalances(changes, '2026-11-02', '2026-11-03')).toEqual([100, 250])
  })

  it('leaves out the days before any balance is known', () => {
    expect(dailyBalances(changes, '2026-10-30', '2026-11-01')).toEqual([100])
    expect(dailyBalances([], '2026-11-01', '2026-11-03')).toEqual([])
  })
})

describe('recentBalances', () => {
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

  it("reads each account's last few weeks, from the change before them on", async () => {
    const checking = await insertBankAccount(ctx.db, { name: 'Checking' })
    const savings = await insertBankAccount(ctx.db, { name: 'Savings' })
    await ctx.db.query('DELETE FROM balance_history')
    await ctx.db.query(
      `INSERT INTO balance_history (account_id, day, balance_cents) VALUES
         ($1, '2026-09-01', 5000), ($1, '2026-11-18', 7000), ($1, '2026-11-20', 9000),
         ($2, '2026-11-19', 300)`,
      [checking.accountId, savings.accountId],
    )
    const recent = await recentBalances(ctx.db, '2026-11-19')
    const byAccount = new Map(recent.map((one) => [one.accountId, one.balancesCents]))
    const line = byAccount.get(checking.accountId)!
    // Thirty days, opening on September's balance, and nothing after today.
    expect(line).toHaveLength(RECENT_BALANCE_DAYS)
    expect(line.slice(0, 2)).toEqual([5000, 5000])
    expect(line.slice(-2)).toEqual([7000, 7000])
    expect(byAccount.get(savings.accountId)).toEqual([300])
  })

  it('gives an account with no balance history an empty line, through its action', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await ctx.db.query('DELETE FROM balance_history')
    expect(await call('list_recent_balances', {})).toEqual([{ accountId, balancesCents: [] }])
  })
})
