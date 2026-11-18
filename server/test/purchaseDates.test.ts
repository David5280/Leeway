// Moving transactions synced before Leeway used purchase dates onto the day of purchase.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import { BankError } from '../src/bank/provider.js'
import type { AppContext } from '../src/context.js'
import { linkBank } from '../src/domain/connections.js'
import { actionCaller } from './actionCaller.js'
import { bankTx, FakeBank, page } from './fakeBank.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
let bank: FakeBank
const { call, callError } = actionCaller(() => ctx)

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

describe('using purchase dates for older transactions', () => {
  it('moves only the dates of known transactions, keeping everything the owner set', async () => {
    const coffee = bankTx({ name: 'Coffee', amountCents: 500, date: '2026-11-10' })
    const rent = bankTx({ name: 'Rent', amountCents: 150000, date: '2026-11-01' })
    const gas = bankTx({ name: 'Gas', amountCents: 4000, date: '2026-11-05' })
    bank.pages = [page({ added: [coffee, rent, gas] })]
    await linkBank(ctx, 'public-1')
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
    const results = await call('use_purchase_dates')

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
  })

  it('changes nothing when run a second time', async () => {
    const coffee = bankTx({ name: 'Coffee', amountCents: 500, date: '2026-11-10' })
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-1')
    const history = () => [page({ added: [{ ...coffee, date: '2026-11-08' }] })]

    bank.pages = history()
    expect((await call('use_purchase_dates'))[0]).toMatchObject({ checked: 1, changed: 1 })
    bank.pages = history()
    expect((await call('use_purchase_dates'))[0]).toMatchObject({ checked: 1, changed: 0 })
    expect((await listAll()).map((tx) => tx.date)).toEqual(['2026-11-08'])
  })

  it('matches by the bank id within the connection, never another bank with the same ids', async () => {
    const coffee = bankTx({ name: 'Coffee', amountCents: 500, date: '2026-11-10' })
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-1')
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-2')

    // Only the first connection's history says the date moved.
    bank.pages = [page({ added: [{ ...coffee, date: '2026-11-08' }] }), page({ added: [coffee] })]
    const results = await call('use_purchase_dates')
    expect(results.map((r) => r.changed)).toEqual([1, 0])
    expect((await listAll()).map((tx) => tx.date).sort()).toEqual(['2026-11-08', '2026-11-10'])
  })

  it('reports a bank that fails and carries on with the others', async () => {
    const coffee = bankTx({ name: 'Coffee', amountCents: 500, date: '2026-11-10' })
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-1')
    bank.pages = [page({ added: [coffee] })]
    await linkBank(ctx, 'public-2')

    const sync = bank.syncTransactions.bind(bank)
    let calls = 0
    bank.syncTransactions = async (token, cursor) => {
      calls += 1
      if (calls === 1) throw new BankError('Sign in to your bank again', true)
      return sync(token, cursor)
    }
    bank.pages = [page({ added: [{ ...coffee, date: '2026-11-07' }] })]
    const results = await call('use_purchase_dates')
    expect(results.map((r) => [r.error, r.changed])).toEqual([
      ['Sign in to your bank again', 0],
      [null, 1],
    ])
    // Nothing was synced, so the connection's status is left as it was.
    const { rows } = await ctx.db.query('SELECT status FROM connections')
    expect(rows.map((r) => r.status)).toEqual(['active', 'active'])
  })

  it('lets an unexpected failure through', async () => {
    bank.pages = [page({ added: [bankTx({ name: 'Coffee', amountCents: 500 })] })]
    await linkBank(ctx, 'public-1')
    bank.syncTransactions = async () => {
      throw new Error('boom')
    }
    await expect(call('use_purchase_dates')).rejects.toThrow('boom')
  })

  it('handles a bank with no transactions, and no banks at all', async () => {
    expect(await call('use_purchase_dates')).toEqual([])
    await linkBank(ctx, 'public-1')
    expect((await call('use_purchase_dates'))[0]).toMatchObject({ checked: 0, changed: 0 })
  })

  it('explains when bank sync is not set up', async () => {
    ctx.bank = null
    const error = await callError('use_purchase_dates')
    expect(error.code).toBe('not_configured')
  })

  it('is a write action', () => {
    expect(findAction('use_purchase_dates')).toMatchObject({ scope: 'write', surface: 'all' })
  })
})
