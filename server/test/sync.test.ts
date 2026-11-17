import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BankError } from '../src/bank/provider.js'
import type { AppContext } from '../src/context.js'
import { categoryInputSchema, createCategory } from '../src/domain/categories.js'
import {
  handleBankWebhook,
  linkBank,
  listConnections,
  removeConnection,
  syncConnection,
} from '../src/domain/connections.js'
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
