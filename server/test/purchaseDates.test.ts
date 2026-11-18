// Moving transactions from banks linked before Leeway used purchase dates onto
// the day of purchase, once and on its own.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import { BankError } from '../src/bank/provider.js'
import type { AppContext } from '../src/context.js'
import { linkBank } from '../src/domain/connections.js'
import {
  catchUpPurchaseDates,
  purchaseDatesSummary,
  type PurchaseDatesResult,
} from '../src/domain/purchaseDates.js'
import { actionCaller } from './actionCaller.js'
import { bankTx, FakeBank, page } from './fakeBank.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
let bank: FakeBank
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  bank = new FakeBank()
  ctx.bank = bank
})

const listAll = async () =>
  (await call('list_transactions', { includeExcluded: true, limit: 500 })).transactions

const cursors = async () =>
  (
    await ctx.db.query<{ cursor: string }>(
      'SELECT sync_cursor AS cursor FROM connections ORDER BY created_at',
    )
  ).rows.map((r) => r.cursor)

/** Makes every linked bank look like one linked before purchase dates, which the catch-up corrects. */
const linkedBeforePurchaseDates = () =>
  ctx.db.query('UPDATE connections SET purchase_dates_at = NULL')

const catchUp = () => catchUpPurchaseDates(ctx)

const correctedBanks = async () =>
  (
    await ctx.db.query<{ done: boolean }>(
      'SELECT purchase_dates_at IS NOT NULL AS done FROM connections ORDER BY created_at',
    )
  ).rows.map((r) => r.done)

describe('catching up purchase dates for banks linked earlier', () => {
  it('moves only the dates of known transactions, keeping everything the owner set', async () => {
    const coffee = bankTx({ name: 'Coffee', amountCents: 500, date: '2026-11-10' })
    const rent = bankTx({ name: 'Rent', amountCents: 150000, date: '2026-11-01' })
    const gas = bankTx({ name: 'Gas', amountCents: 4000, date: '2026-11-05' })
    bank.pages = [page({ added: [coffee, rent, gas] })]
    await linkBank(ctx, 'public-1')
    await linkedBeforePurchaseDates()
    const cursorBefore = await cursors()

    const treats = await call('create_category', { name: 'Treats' })
    const saved = new Map((await listAll()).map((tx) => [tx.name, tx]))
    await call('update_transaction', {
      id: saved.get('Coffee')!.id,
      categoryId: treats.id,
      note: 'with Sam',
      excluded: true,
    })

    // The whole history again: Coffee was bought two days before it posted,
    // Rent did not move, Gas comes as a modification, and one the app never
    // saw must not be added.
    bank.pages = [
      page({
        added: [
          { ...coffee, date: '2026-11-08' },
          rent,
          bankTx({ name: 'Never synced', amountCents: 1 }),
        ],
        hasMore: true,
      }),
      page({ modified: [{ ...gas, date: '2026-11-03' }] }),
    ]
    const results = await catchUp()

    expect(results).toEqual([
      {
        connectionId: expect.any(String),
        institutionName: 'First Platypus Bank',
        checked: 4,
        changed: 2,
        error: null,
      },
    ])
    // The full history was asked for from the beginning, without the saved cursor.
    expect(bank.cursorsSeen.at(-2)).toBeNull()
    const after = new Map((await listAll()).map((tx) => [tx.name, tx]))
    expect([...after.keys()].sort()).toEqual(['Coffee', 'Gas', 'Rent'])
    expect(after.get('Coffee')).toMatchObject({
      date: '2026-11-08',
      categoryId: treats.id,
      categorySource: 'manual',
      note: 'with Sam',
      excluded: true,
    })
    expect(after.get('Gas')!.date).toBe('2026-11-03')
    expect(after.get('Rent')!.date).toBe('2026-11-01')
    expect(await cursors()).toEqual(cursorBefore)
    expect(await correctedBanks()).toEqual([true])
  })

  it('runs once per bank: a second catch-up asks no bank for anything', async () => {
    const coffee = bankTx({ name: 'Coffee', amountCents: 500, date: '2026-11-10' })
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-1')
    await linkedBeforePurchaseDates()

    bank.pages = [page({ added: [{ ...coffee, date: '2026-11-08' }] })]
    expect((await catchUp())[0]).toMatchObject({ checked: 1, changed: 1 })
    const asked = bank.cursorsSeen.length
    expect(await catchUp()).toEqual([])
    expect(bank.cursorsSeen).toHaveLength(asked)
    expect((await listAll()).map((tx) => tx.date)).toEqual(['2026-11-08'])
  })

  it('leaves banks linked from now on alone, since their dates are already right', async () => {
    bank.pages = [page({ added: [bankTx({ name: 'Coffee', amountCents: 500 })] })]
    await linkBank(ctx, 'public-1')
    expect(await correctedBanks()).toEqual([true])
    const asked = bank.cursorsSeen.length
    expect(await catchUp()).toEqual([])
    expect(bank.cursorsSeen).toHaveLength(asked)
  })

  it('matches by the bank id within the connection, never another bank with the same ids', async () => {
    const coffee = bankTx({ name: 'Coffee', amountCents: 500, date: '2026-11-10' })
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-1')
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-2')
    await linkedBeforePurchaseDates()

    // Only the first connection's history says the date moved.
    bank.pages = [page({ added: [{ ...coffee, date: '2026-11-08' }] }), page({ added: [coffee] })]
    const results = await catchUp()
    expect(results.map((r) => r.changed)).toEqual([1, 0])
    expect((await listAll()).map((tx) => tx.date).sort()).toEqual(['2026-11-08', '2026-11-10'])
  })

  it('carries on past a bank that fails, and tries that bank again next time', async () => {
    const coffee = bankTx({ name: 'Coffee', amountCents: 500, date: '2026-11-10' })
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-1')
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-2')
    await linkedBeforePurchaseDates()

    const sync = bank.syncTransactions.bind(bank)
    let calls = 0
    bank.syncTransactions = async (token, cursor) => {
      calls += 1
      if (calls === 1) throw new BankError('Sign in to your bank again', true)
      return sync(token, cursor)
    }
    bank.pages = [page({ added: [{ ...coffee, date: '2026-11-07' }] })]
    const results = await catchUp()
    expect(results.map((r) => [r.error, r.changed])).toEqual([
      ['Sign in to your bank again', 0],
      [null, 1],
    ])
    expect(await correctedBanks()).toEqual([false, true])
    // Nothing was synced, so the connection's status is left as it was.
    const { rows } = await ctx.db.query('SELECT status FROM connections')
    expect(rows.map((r) => r.status)).toEqual(['active', 'active'])

    // Next time only the failed bank is asked, and once it answers it is done.
    bank.pages = [page({ added: [{ ...coffee, date: '2026-11-07' }] })]
    const retry = await catchUp()
    expect(retry.map((r) => [r.connectionId, r.changed])).toEqual([[results[0]!.connectionId, 1]])
    expect(await correctedBanks()).toEqual([true, true])
  })

  it('lets an unexpected failure through, leaving the bank to try again', async () => {
    bank.pages = [page({ added: [bankTx({ name: 'Coffee', amountCents: 500 })] })]
    await linkBank(ctx, 'public-1')
    await linkedBeforePurchaseDates()
    bank.syncTransactions = async () => {
      throw new Error('boom')
    }
    await expect(catchUp()).rejects.toThrow('boom')
    expect(await correctedBanks()).toEqual([false])
  })

  it('handles a bank with no transactions, and no banks at all', async () => {
    expect(await catchUp()).toEqual([])
    await linkBank(ctx, 'public-1')
    await linkedBeforePurchaseDates()
    expect((await catchUp())[0]).toMatchObject({ checked: 0, changed: 0 })
    expect(await correctedBanks()).toEqual([true])
  })

  it('does nothing when bank sync is not set up', async () => {
    await linkBank(ctx, 'public-1')
    await linkedBeforePurchaseDates()
    ctx.bank = null
    expect(await catchUp()).toEqual([])
    expect(await correctedBanks()).toEqual([false])
  })
})

describe('the log line for a catch-up', () => {
  const result = (fields: Partial<PurchaseDatesResult> = {}): PurchaseDatesResult => ({
    connectionId: 'conn-1',
    institutionName: 'First Bank',
    checked: 10,
    changed: 0,
    error: null,
    ...fields,
  })

  it('says nothing when there was nothing to do', () => {
    expect(purchaseDatesSummary([])).toBeNull()
  })

  it('counts what moved across banks', () => {
    expect(purchaseDatesSummary([result({ changed: 11 }), result({ changed: 1 })])).toBe(
      'Purchase dates: moved 12 older transactions to the day of purchase.',
    )
    expect(purchaseDatesSummary([result({ changed: 1 })])).toBe(
      'Purchase dates: moved 1 older transaction to the day of purchase.',
    )
  })

  it('names each bank it will try again', () => {
    expect(
      purchaseDatesSummary([
        result({ changed: 2 }),
        result({ institutionName: 'Credit Union', error: 'Sign in again' }),
        result({ institutionName: null, error: 'Down' }),
      ]),
    ).toBe(
      'Purchase dates: moved 2 older transactions to the day of purchase. Will retry: Credit Union (Sign in again), A bank (Down).',
    )
  })
})

describe('the purchase dates button', () => {
  it('is gone, because the catch-up runs on its own', () => {
    expect(findAction('use_purchase_dates')).toBeUndefined()
  })
})
