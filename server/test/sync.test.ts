import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BankError } from '../src/bank/provider.js'
import type { AppContext } from '../src/context.js'
import { categoryInputSchema, createCategory } from '../src/domain/categories.js'
import {
  handleBankWebhook,
  linkBank,
  listConnections,
  removeConnection,
} from '../src/domain/connections.js'
import { latestOfEach, syncConnection } from '../src/domain/sync.js'
import { listTransactions, setCategory } from '../src/domain/transactions.js'
import { account, bankTx, FakeBank, page } from './fakeBank.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
let bank: FakeBank

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

const all = async () =>
  (await listTransactions(ctx.db, { limit: 500, offset: 0, includeExcluded: true })).transactions

describe('bank sync', () => {
  it('links a bank, stores the token encrypted, and pulls accounts and history', async () => {
    const groceries = await createCategory(
      ctx.db,
      categoryInputSchema.parse({
        name: 'Groceries',
        color: '#00aa00',
        icon: null,
        kind: 'expense',
        budgetCents: 50000,
        budgetCadence: 'month',
        warnAtPercent: null,
        providerCategories: ['FOOD_AND_DRINK_GROCERIES'],
      }),
    )
    bank.accounts.push(account('acc-card', 'Sapphire', 'credit', 120000))
    bank.pages = [
      page({
        added: [
          bankTx({
            name: 'Safeway',
            amountCents: 4500,
            categoryDetailed: 'FOOD_AND_DRINK_GROCERIES',
          }),
        ],
        hasMore: true,
      }),
      page({
        added: [bankTx({ name: 'Shell', amountCents: 4000, providerAccountId: 'acc-card' })],
      }),
    ]

    const result = await linkBank(ctx, 'public-1')
    expect(result).toMatchObject({ added: 2, error: null, institutionName: 'First Platypus Bank' })

    const { rows } = await ctx.db.query(
      'SELECT access_token_encrypted, sync_cursor FROM connections',
    )
    expect(rows[0].access_token_encrypted).not.toContain('access-public-1')
    expect(rows[0].sync_cursor).toBeTruthy()

    const txs = await all()
    expect(txs).toHaveLength(2)
    expect(txs.find((t) => t.name === 'Safeway')).toMatchObject({
      categoryId: groceries.id,
      categorySource: 'provider',
    })
    const [connection] = await listConnections(ctx.db)
    expect(connection).toMatchObject({ status: 'active', accountCount: 2 })
  })

  it('applies modified and removed transactions and continues from the saved cursor', async () => {
    const first = bankTx({ name: 'Coffee', amountCents: 500 })
    const second = bankTx({ name: 'Lunch', amountCents: 1500 })
    bank.pages = [page({ added: [first, second], nextCursor: 'cursor-1' })]
    const { connectionId } = await linkBank(ctx, 'public-2')

    bank.pages = [
      page({
        modified: [{ ...first, amountCents: 550 }],
        removed: [second.providerTransactionId],
        nextCursor: 'cursor-2',
      }),
    ]
    const result = await syncConnection(ctx, connectionId)
    expect(result).toMatchObject({ added: 0, modified: 1, removed: 1 })
    expect(bank.cursorsSeen).toEqual([null, 'cursor-1'])
    const txs = await all()
    expect(txs.map((t) => [t.name, t.amountCents])).toEqual([['Coffee', 550]])
  })

  it('carries a manual category and note from a pending charge to the posted one', async () => {
    const dining = await createCategory(
      ctx.db,
      categoryInputSchema.parse({
        name: 'Dining',
        color: '#ff0000',
        icon: null,
        kind: 'expense',
        budgetCents: null,
        budgetCadence: 'month',
        warnAtPercent: null,
        providerCategories: [],
      }),
    )
    const pending = bankTx({ name: 'Bistro', amountCents: 3000, pending: true })
    bank.pages = [page({ added: [pending] })]
    const { connectionId } = await linkBank(ctx, 'public-3')
    const [pendingRow] = await all()
    await setCategory(ctx.db, [pendingRow!.id], dining.id)
    await ctx.db.query(`UPDATE transactions SET note = 'date night'`)

    bank.pages = [
      page({
        added: [
          bankTx({
            name: 'Bistro',
            amountCents: 3600,
            pendingProviderTransactionId: pending.providerTransactionId,
          }),
        ],
        removed: [pending.providerTransactionId],
      }),
    ]
    await syncConnection(ctx, connectionId)
    const txs = await all()
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({
      amountCents: 3600,
      pending: false,
      categoryId: dining.id,
      categorySource: 'manual',
      note: 'date night',
    })
  })

  it('marks a connection for re-login and keeps the old data when the bank refuses', async () => {
    bank.pages = [page({ added: [bankTx({ name: 'Rent', amountCents: 150000 })] })]
    const { connectionId } = await linkBank(ctx, 'public-4')

    bank.failNext = new BankError('Log in again (ITEM_LOGIN_REQUIRED)', true)
    const result = await syncConnection(ctx, connectionId)
    expect(result.error).toContain('ITEM_LOGIN_REQUIRED')
    const [connection] = await listConnections(ctx.db)
    expect(connection).toMatchObject({ status: 'needs_reauth' })
    expect(await all()).toHaveLength(1)

    // A webhook saying the login was repaired brings it back.
    await handleBankWebhook(ctx, 'item-public-4', 'repaired')
    expect((await listConnections(ctx.db))[0]).toMatchObject({ status: 'active', lastError: null })
  })

  it('removes a connection with its accounts and tells the bank', async () => {
    bank.pages = [page({ added: [bankTx({ name: 'Gym', amountCents: 4000 })] })]
    const { connectionId } = await linkBank(ctx, 'public-5')
    await removeConnection(ctx, connectionId)
    expect(bank.removedItems).toEqual(['access-public-5'])
    expect(await all()).toHaveLength(0)
    expect(await listConnections(ctx.db)).toHaveLength(0)
  })
})

describe('pending charges that post', () => {
  it('replaces the pending charge once, even when the posted one has another date', async () => {
    const pending = bankTx({
      name: 'Hardware',
      amountCents: 2500,
      pending: true,
      date: '2026-11-13',
    })
    bank.pages = [page({ added: [pending] })]
    const { connectionId } = await linkBank(ctx, 'public-6')
    await ctx.db.query(`UPDATE transactions SET excluded = true`)

    bank.pages = [
      page({
        added: [
          bankTx({
            name: 'Hardware',
            amountCents: 2500,
            date: '2026-11-16',
            pendingProviderTransactionId: pending.providerTransactionId,
          }),
        ],
        removed: [pending.providerTransactionId],
      }),
    ]
    await syncConnection(ctx, connectionId)

    const txs = await all()
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ date: '2026-11-16', pending: false, excluded: true })
  })

  it('never doubles a charge whose pending and posted versions arrive in one sync', async () => {
    const pending = bankTx({ name: 'Diner', amountCents: 1800, pending: true })
    const posted = bankTx({
      name: 'Diner',
      amountCents: 2100,
      pendingProviderTransactionId: pending.providerTransactionId,
    })
    bank.pages = [page({ added: [pending, posted], removed: [pending.providerTransactionId] })]

    await linkBank(ctx, 'public-7')

    expect((await all()).map((t) => [t.name, t.amountCents, t.pending])).toEqual([
      ['Diner', 2100, false],
    ])
  })
})

describe('applying many changes at once', () => {
  it('writes the newest version of a transaction the bank names twice in one sync', async () => {
    const coffee = bankTx({ name: 'Coffee', amountCents: 400 })
    bank.pages = [
      page({ added: [coffee], hasMore: true }),
      page({ modified: [{ ...coffee, amountCents: 475, name: 'Coffee bar' }] }),
    ]

    const result = await linkBank(ctx, 'public-8')

    expect(result).toMatchObject({ added: 1, modified: 1, error: null })
    expect((await all()).map((t) => [t.name, t.amountCents])).toEqual([['Coffee bar', 475]])
  })

  it('saves a large first sync in full', async () => {
    const history = Array.from({ length: 1200 }, (_, i) =>
      bankTx({ name: `Purchase ${i}`, amountCents: 100 + i, date: '2026-10-01' }),
    )
    bank.pages = [
      page({ added: history.slice(0, 500), hasMore: true }),
      page({ added: history.slice(500, 1000), hasMore: true }),
      page({ added: history.slice(1000) }),
    ]

    await linkBank(ctx, 'public-9')

    const { rows } = await ctx.db.query<{ n: number; total: number }>(
      'SELECT count(*)::int AS n, sum(amount_cents)::int AS total FROM transactions',
    )
    expect(rows[0]).toEqual({ n: 1200, total: history.reduce((s, t) => s + t.amountCents, 0) })
  })
})

describe('transfers across syncs', () => {
  it('pairs again when a later sync brings a closer other side, and files the one left over', async () => {
    // Only pairing files into Transfers; a lone arrival is income, as the bank says.
    const transfers = await createCategory(
      ctx.db,
      categoryInputSchema.parse({ name: 'Transfers', kind: 'transfer' }),
    )
    const income = await createCategory(
      ctx.db,
      categoryInputSchema.parse({
        name: 'Income',
        kind: 'income',
        providerCategories: ['TRANSFER_IN'],
      }),
    )
    bank.accounts.push(account('acc-savings', 'Savings', 'depository', 0))
    const moved = { amountCents: 10000 }
    const out = bankTx({ name: 'TRANSFER TO SAVINGS', ...moved, categoryPrimary: 'TRANSFER_OUT' })
    const arrival = (date: string) =>
      bankTx({
        name: 'TRANSFER FROM CHECKING',
        amountCents: -moved.amountCents,
        providerAccountId: 'acc-savings',
        date,
        categoryPrimary: 'TRANSFER_IN',
      })
    const late = arrival('2026-11-14')
    bank.pages = [page({ added: [out, late] })]
    const { connectionId } = await linkBank(ctx, 'public-pairs')
    const byBankId = async () =>
      new Map(
        (
          await ctx.db.query<{ id: string; provider_transaction_id: string }>(
            'SELECT id, provider_transaction_id FROM transactions',
          )
        ).rows.map((row) => [row.provider_transaction_id, row.id]),
      )
    let ids = await byBankId()
    let listed = new Map((await all()).map((tx) => [tx.id, tx]))
    expect(listed.get(ids.get(out.providerTransactionId)!)?.transfer?.id).toBe(
      ids.get(late.providerTransactionId),
    )

    const close = arrival('2026-11-11')
    bank.pages = [page({ added: [close] })]
    await syncConnection(ctx, connectionId)
    ids = await byBankId()
    listed = new Map((await all()).map((tx) => [tx.id, tx]))
    const idOf = (tx: { providerTransactionId: string }) => ids.get(tx.providerTransactionId)!
    const [outId, lateId, closeId] = [idOf(out), idOf(late), idOf(close)]
    expect(listed.get(outId)).toMatchObject({ categoryId: transfers.id, transfer: { id: closeId } })
    expect(listed.get(closeId)).toMatchObject({ categoryId: transfers.id, transfer: { id: outId } })
    // The arrival left over is no longer a transfer, and says so everywhere.
    expect(listed.get(lateId)).toMatchObject({ categoryId: income.id, transfer: null })
  })
})

describe('latestOfEach', () => {
  it('keeps the last version of each transaction, in the order first seen', () => {
    const a = bankTx({ name: 'A', amountCents: 1 })
    const b = bankTx({ name: 'B', amountCents: 2 })
    const result = latestOfEach([a, b, { ...a, amountCents: 3 }])
    expect(result.map((t) => [t.name, t.amountCents])).toEqual([
      ['A', 3],
      ['B', 2],
    ])
  })

  it('tells apart the same bank id on two accounts', () => {
    const onChecking = bankTx({ name: 'A', amountCents: 1 })
    const onCard = { ...onChecking, providerAccountId: 'acc-card' }
    expect(latestOfEach([onChecking, onCard])).toHaveLength(2)
  })
})
