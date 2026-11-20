// Net worth before balances were first recorded: bank and card balances
// walked back through their transactions, other accounts held, and the
// rebuilt part marked as an estimate (netWorthRebuild.ts).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { netWorthSeries } from '../src/domain/netWorth.js'
import {
  historyStart,
  rebuildBalances,
  type RebuildAccount,
} from '../src/domain/netWorthRebuild.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const bank = (id: string, type: RebuildAccount['type'] = 'depository'): RebuildAccount => ({
  id,
  type,
  banked: true,
})
const move = (accountId: string, date: string, amountCents: number) => ({
  accountId,
  date,
  amountCents,
})

describe('rebuildBalances', () => {
  it('undoes deposits and purchases back from the first recorded balance', () => {
    const { snapshots, estimatedBefore } = rebuildBalances(
      [bank('checking')],
      [{ accountId: 'checking', day: '2026-11-17', balanceCents: 300000 }],
      [
        move('checking', '2026-11-10', -200000),
        move('checking', '2026-11-12', 5000),
        move('checking', '2026-11-12', 500),
        // On or after the first recorded day, or before the start: nothing to undo.
        move('checking', '2026-11-18', 9900),
        move('checking', '2026-10-20', 9900),
      ],
      '2026-11-01',
    )
    expect(snapshots).toEqual([
      // Two purchases on the 12th: $3,055 at the end of the 11th.
      { accountId: 'checking', day: '2026-11-12', balanceCents: 300000 },
      { accountId: 'checking', day: '2026-11-11', balanceCents: 305500 },
      // Before the $2,000 pay arrived.
      { accountId: 'checking', day: '2026-11-10', balanceCents: 305500 },
      { accountId: 'checking', day: '2026-11-09', balanceCents: 105500 },
      // Held there back to the start.
      { accountId: 'checking', day: '2026-11-01', balanceCents: 105500 },
    ])
    expect(estimatedBefore).toBe('2026-11-17')
  })

  it('walks a card back the other way, so a payment between own accounts nets out', () => {
    const real = [
      { accountId: 'checking', day: '2026-11-17', balanceCents: 100000 },
      { accountId: 'card', day: '2026-11-17', balanceCents: 20000 },
    ]
    const { snapshots } = rebuildBalances(
      [bank('checking'), bank('card', 'credit')],
      real,
      [
        // $500 paid from checking to the card, and a $100 purchase on the card before it.
        move('checking', '2026-11-14', 50000),
        move('card', '2026-11-14', -50000),
        move('card', '2026-11-13', 10000),
      ],
      '2026-11-10',
    )
    const series = netWorthSeries(
      [...real, ...snapshots],
      new Set(['card']),
      '2026-11-10',
      '2026-11-17',
    )
    expect(series.map((p) => [p.date, p.assetsCents, p.liabilitiesCents])).toEqual([
      // $1,500 held, $600 owed before the purchase.
      ['2026-11-10', 150000, 60000],
      ['2026-11-12', 150000, 60000],
      // The purchase adds to what is owed; the payment moves money without changing net worth.
      ['2026-11-13', 150000, 70000],
      ['2026-11-14', 100000, 20000],
      ['2026-11-17', 100000, 20000],
    ])
  })

  it('holds a loan, an investment and a hand-kept account at their first balance', () => {
    const { snapshots } = rebuildBalances(
      [bank('loan', 'loan'), bank('brokerage', 'investment'), { ...bank('cash'), banked: false }],
      [
        { accountId: 'loan', day: '2026-11-17', balanceCents: 900000 },
        { accountId: 'brokerage', day: '2026-11-17', balanceCents: 400000 },
        { accountId: 'cash', day: '2026-11-17', balanceCents: 3000 },
      ],
      // Transactions on a hand-kept account say nothing sure about its balance.
      [move('loan', '2026-11-05', -30000), move('cash', '2026-11-05', 1000)],
      '2026-11-01',
    )
    expect(snapshots).toEqual([
      { accountId: 'loan', day: '2026-11-01', balanceCents: 900000 },
      { accountId: 'brokerage', day: '2026-11-01', balanceCents: 400000 },
      { accountId: 'cash', day: '2026-11-01', balanceCents: 3000 },
    ])
  })

  it('starts an account opened partway through the range from nothing', () => {
    const { snapshots } = rebuildBalances(
      [bank('savings')],
      [{ accountId: 'savings', day: '2026-11-17', balanceCents: 50000 }],
      [move('savings', '2026-11-05', -50000)],
      '2026-11-01',
    )
    expect(snapshots).toEqual([
      { accountId: 'savings', day: '2026-11-05', balanceCents: 50000 },
      { accountId: 'savings', day: '2026-11-04', balanceCents: 0 },
      { accountId: 'savings', day: '2026-11-01', balanceCents: 0 },
    ])
  })

  it('estimates nothing for an account recorded from the start, or never', () => {
    expect(
      rebuildBalances(
        [bank('checking'), bank('new')],
        [{ accountId: 'checking', day: '2026-10-01', balanceCents: 100 }],
        [move('checking', '2026-10-05', 50)],
        '2026-11-01',
      ),
    ).toEqual({ snapshots: [], estimatedBefore: null })
  })

  it('reaches back to the day before the earliest transaction, or the first recorded balance', () => {
    const real = [{ accountId: 'checking', day: '2026-11-17', balanceCents: 100 }]
    expect(historyStart(real, [move('checking', '2026-03-03', 5)])).toBe('2026-03-02')
    expect(historyStart(real, [])).toBe('2026-11-17')
    expect(historyStart([], [])).toBeNull()
  })
})

describe('get_net_worth before balances were recorded', () => {
  // The test clock reads 2026-11-17.
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

  /** A bank account first recorded on Nov 17 at this balance, as when it was linked that day. */
  async function linkedOnNov17(balanceCents: number, type = 'depository') {
    const { accountId } = await insertBankAccount(ctx.db, { type, balanceCents })
    await ctx.db.query('DELETE FROM balance_history WHERE account_id = $1', [accountId])
    await ctx.db.query(
      `INSERT INTO balance_history (account_id, day, balance_cents) VALUES ($1, '2026-11-17', $2)`,
      [accountId, balanceCents],
    )
    return accountId
  }

  it('reaches back through transactions, so each range shows its own history', async () => {
    const checking = await linkedOnNov17(500000)
    // Pay eight months ago, and a purchase last week.
    await insertBankTransaction(ctx.db, checking, {
      date: '2026-03-15',
      name: 'ACME PAYROLL',
      amountCents: -300000,
    })
    await insertBankTransaction(ctx.db, checking, {
      date: '2026-11-10',
      name: 'Grocer',
      amountCents: 20000,
    })
    // Pending: not yet moved the balance.
    await insertBankTransaction(ctx.db, checking, {
      date: '2026-11-16',
      name: 'Cafe',
      amountCents: 900,
      pending: true,
    })

    const quarter = await call('get_net_worth', { days: 90 })
    const year = await call('get_net_worth', { days: 365 })
    expect(quarter.history.map((p) => [p.date, p.netWorthCents])).toEqual([
      ['2026-08-19', 520000],
      // The purchase steps it down on the 10th.
      ['2026-11-09', 520000],
      ['2026-11-10', 500000],
      ['2026-11-17', 500000],
    ])
    // The year starts the day before the first transaction, from $2,200.
    expect(year.history.map((p) => [p.date, p.netWorthCents])).toEqual([
      ['2026-03-14', 220000],
      ['2026-03-15', 520000],
      ['2026-11-09', 520000],
      ['2026-11-10', 500000],
      ['2026-11-17', 500000],
    ])
    expect(year).toMatchObject({ historyStart: '2026-03-14', estimatedBefore: '2026-11-17' })
    // Five years reach no further than the history does.
    expect((await call('get_net_worth', { days: 1825 })).history).toEqual(year.history)
  })

  it('leaves the check-in on recorded balances, so its change is never an estimate', async () => {
    const checking = await linkedOnNov17(500000)
    await insertBankTransaction(ctx.db, checking, {
      date: '2026-11-10',
      name: 'ACME PAYROLL',
      amountCents: -300000,
    })
    const checkin = await call('get_checkin', {})
    // Recorded only on Nov 17, so no change yet, though the estimate shows $3,000 more.
    expect(checkin.netWorth.changeCents).toBe(0)
    const estimated = await call('get_net_worth', { days: 30 })
    expect(estimated.history[0]!.netWorthCents).toBe(200000)
  })

  it('marks nothing as estimated once the range starts after the first recorded balance', async () => {
    await linkedOnNov17(500000)
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 100 })
    await ctx.db.query('DELETE FROM balance_history WHERE account_id = $1', [accountId])
    await ctx.db.query(
      `INSERT INTO balance_history (account_id, day, balance_cents) VALUES ($1, '2026-01-01', 100)`,
      [accountId],
    )
    const worth = await call('get_net_worth', { days: 7 })
    // The new account is held from Nov 10, before it was recorded: an estimate.
    expect(worth.estimatedBefore).toBe('2026-11-17')
    await ctx.db.query(`UPDATE balance_history SET day = '2026-11-01'`)
    expect((await call('get_net_worth', { days: 7 })).estimatedBefore).toBeNull()
  })
})
