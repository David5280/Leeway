// The overdraft forecast from stored data, through get_overdraft_forecast and
// list_alerts: which account each bill comes out of, usual spending from
// recent history, and the move that would cover a shortfall. Every name and
// amount is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { createBill } from '../src/domain/bills.js'
import { accountCandidates } from '../src/domain/notifications/words.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-17, in UTC. With no paycheck, payday is the
// monthly budget period's end, the next one starting December 1st.
// Accounts are named with their bank, as two at different banks would be.
const TODAY = '2026-11-17'
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

const checking = (name: string, balanceCents: number) =>
  insertBankAccount(ctx.db, { name, subtype: 'checking', balanceCents }).then((a) => a.accountId)

async function bill(
  name: string,
  amountCents: number,
  anchorDate: string,
  accountId: string | null,
) {
  return createBill(
    ctx.db,
    {
      name,
      kind: 'bill',
      amountCents,
      cadence: 'month',
      anchorDate,
      matchPattern: null,
      categoryId: null,
      autopay: true,
    },
    TODAY,
    {},
    { accountId },
  )
}

/** Spending out of an account on each of these days. */
async function spend(accountId: string, days: string[], amountCents: number, name = 'GROCER') {
  for (const date of days)
    await insertBankTransaction(ctx.db, accountId, { date, name, amountCents })
}

describe('get_overdraft_forecast', () => {
  it('has nothing to forecast without a checking account', async () => {
    await insertBankAccount(ctx.db, { name: 'Savings', subtype: 'savings' })
    expect(await call('get_overdraft_forecast')).toEqual({
      payday: '2026-12-01',
      paydayEstimate: false,
      accounts: [],
    })
  })

  it('warns that rent takes checking below zero, and suggests covering it from savings', async () => {
    const everyday = await checking('Everyday', 50_000)
    await insertBankAccount(ctx.db, {
      name: 'Rainy day',
      subtype: 'savings',
      balanceCents: 300_000,
    })
    await bill('Rent', 62_500, '2026-11-20', everyday)
    const { accounts } = await call('get_overdraft_forecast')
    expect(accounts).toEqual([
      expect.objectContaining({
        accountName: 'Test Everyday',
        startCents: 50_000,
        belowZeroOn: '2026-11-20',
        shortCents: 12_500,
        overdrawnNow: false,
        move: expect.objectContaining({
          fromAccountName: 'Test Rainy day',
          amountCents: 13_000,
          byDate: '2026-11-19',
        }),
      }),
    ])
  })

  it('takes a bill with no account from the busiest checking, and one paid by card from none', async () => {
    const busy = await checking('Busy', 40_000)
    const quiet = await checking('Quiet', 40_000)
    const card = (await insertBankAccount(ctx.db, { name: 'Card', type: 'credit' })).accountId
    await spend(busy, ['2026-11-02'], 1_000)
    await bill('Insurance', 50_000, '2026-11-22', null)
    await bill('Streaming', 90_000, '2026-11-23', card)
    const { accounts } = await call('get_overdraft_forecast')
    const byName = Object.fromEntries(accounts.map((a) => [a.accountName, a]))
    expect(byName['Test Busy']!.bills.map((b) => b.name)).toEqual(['Insurance'])
    expect(byName['Test Quiet']!.bills).toEqual([])
    // Quiet stays above zero all the way, so it can spare what Busy is short.
    expect(byName['Test Busy']!.move).toMatchObject({ fromAccountId: quiet, amountCents: 11_000 })
  })

  it('counts usual spending from the last eight weeks, bills and moves between accounts aside', async () => {
    const everyday = await checking('Everyday', 200_000)
    const transfers = await call('create_category', { name: 'Moves', kind: 'transfer' })
    // Four weeks of $70 a week in groceries: $280 over the 28 days since the first.
    await spend(everyday, ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'], 7_000)
    // A paid bill is counted on its own due date instead.
    await bill('Gym', 4_000, '2026-10-25', everyday)
    await spend(everyday, ['2026-10-25'], 4_000, 'GYM')
    // Money moved to savings is the owner's choice, not spending.
    const moved = await insertBankTransaction(ctx.db, everyday, {
      date: '2026-11-05',
      name: 'TRANSFER TO SAVINGS',
      amountCents: 50_000,
    })
    await ctx.db.query('UPDATE transactions SET category_id = $1 WHERE id = $2', [
      transfers.id,
      moved,
    ])
    const [forecast] = (await call('get_overdraft_forecast')).accounts
    expect(forecast!.dailySpendCents).toBe(1_000)
    // Fourteen days before payday, Nov 17 to 30.
    expect(forecast!.spendingCents).toBe(14_000)
  })

  it('spreads a new account’s spending over at least two weeks', async () => {
    const everyday = await checking('Everyday', 200_000)
    await spend(everyday, ['2026-11-14'], 14_000)
    const [forecast] = (await call('get_overdraft_forecast')).accounts
    expect(forecast!.dailySpendCents).toBe(1_000)
  })

  it('names accounts as the owner does, never by number', async () => {
    const everyday = (
      await insertBankAccount(ctx.db, { name: 'Everyday', subtype: 'checking', mask: '4321' })
    ).accountId
    await bill('Rent', 150_000, '2026-11-20', everyday)
    expect(JSON.stringify(await call('get_overdraft_forecast'))).not.toContain('4321')
  })
})

describe('usual spending, with a bill paid early', () => {
  it('leaves out a bill paid before its due date, which comes later', async () => {
    const everyday = await checking('Everyday', 200_000)
    await bill('Rent', 140_000, '2026-11-19', everyday)
    await ctx.db.query("UPDATE bills SET match_pattern = 'rent'")
    // Rent is paid on the 10th, ahead of the 19th; groceries are the only spending.
    await spend(everyday, ['2026-11-10'], 140_000, 'RENT PAYMENT')
    await spend(everyday, ['2026-11-12'], 14_000)
    const [forecast] = (await call('get_overdraft_forecast')).accounts
    expect(forecast!.dailySpendCents).toBe(1_000)
    expect(forecast!.bills).toEqual([])
  })
})

describe('the forecast as an alert', () => {
  it('lists checking heading below zero after the account alerts, linking to Payday', async () => {
    const everyday = await checking('Everyday', 50_000)
    const overdrawn = await checking('Joint', -2_000)
    await bill('Rent', 62_500, '2026-11-20', everyday)
    const alerts = await call('list_alerts')
    expect(alerts.map((alert) => [alert.kind, alert.accountName])).toEqual([
      ['overdrawn', 'Test Joint'],
      ['overdraft_forecast', 'Test Everyday'],
    ])
    expect(alerts[1]!.message).toBe(
      'Test Everyday may go $125 below zero on Nov 20, before payday.',
    )
    expect(accountCandidates([alerts[1]!])[0]).toMatchObject({
      title: 'May go below zero',
      pushBody: 'Test Everyday may go below zero before payday.',
      link: '/plan/payday',
    })
    // Picking one account picks its forecast too.
    expect(await call('list_alerts', { accountIds: [overdrawn] })).toHaveLength(1)
  })
})
