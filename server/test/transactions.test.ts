import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import type { Db } from '../src/db/pool.js'
import { listTransactions, transactionFilterSchema } from '../src/domain/transactions.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

// A well-formed id that matches nothing.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const names = (list: { transactions: { name: string }[] }) => list.transactions.map((t) => t.name)

describe('filtering transactions', () => {
  it('filters by account and by a maximum amount', async () => {
    const checking = await insertBankAccount(ctx.db, { name: 'Checking' })
    const card = await insertBankAccount(ctx.db, { name: 'Card' })
    const tx = (accountId: string, name: string, amountCents: number) =>
      insertBankTransaction(ctx.db, accountId, { date: '2026-11-10', name, amountCents })
    await tx(checking.accountId, 'Rent', 150000)
    await tx(checking.accountId, 'Coffee', 500)
    await tx(card.accountId, 'Gas', 4000)

    expect(names(await call('list_transactions', { accountId: card.accountId }))).toEqual(['Gas'])
    const small = await call('list_transactions', { maxAmountCents: 4000 })
    expect(names(small).sort()).toEqual(['Coffee', 'Gas'])
  })

  it('finds text in the merchant name and the note too', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const id = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'SQ *1234',
      merchantName: 'Corner Cafe',
      amountCents: 450,
    })
    await call('update_transaction', { id, note: 'birthday latte' })

    expect((await call('list_transactions', { search: 'corner' })).total).toBe(1)
    expect((await call('list_transactions', { search: 'BIRTHDAY' })).total).toBe(1)
  })

  it('narrows to the merchant of another transaction, as a leak alert links to its charges', async () => {
    const checking = await insertBankAccount(ctx.db, { name: 'Checking' })
    const card = await insertBankAccount(ctx.db, { name: 'Card' })
    const tx = (accountId: string, date: string, name: string, merchantName: string | null) =>
      insertBankTransaction(ctx.db, accountId, { date, name, merchantName, amountCents: 1549 })
    // The bank's text differs by a store number, so these are one merchant.
    const latest = await tx(checking.accountId, '2026-11-10', 'NETFLIX.COM 8473 CA', null)
    await tx(checking.accountId, '2026-10-10', 'Netflix.com 1192 CA', null)
    await tx(card.accountId, '2026-11-09', 'NETFLIX.COM 2210 CA', null)
    // Another merchant, and one whose name only starts the same, stay out.
    await tx(checking.accountId, '2026-11-08', 'NETFLIX GIFT SHOP', null)
    await tx(checking.accountId, '2026-11-07', 'SPOTIFY USA', 'Spotify')

    const same = await call('list_transactions', { sameMerchantAs: latest })
    expect(same.total).toBe(3)
    const onChecking = await call('list_transactions', {
      sameMerchantAs: latest,
      accountId: checking.accountId,
    })
    expect(onChecking.transactions.map((t) => t.date)).toEqual(['2026-11-10', '2026-10-10'])
    // The merchant name the bank gave is what groups a charge, as for repeat charges.
    const spotify = await tx(card.accountId, '2026-11-06', 'SPOTIFY P1234', 'Spotify')
    expect((await call('list_transactions', { sameMerchantAs: spotify })).total).toBe(2)
  })

  it('narrows to nothing for an unknown transaction, or one whose text is all digits', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const digits = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: '#4471 0093',
      amountCents: 100,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: '5512',
      amountCents: 100,
    })
    expect((await call('list_transactions', { sameMerchantAs: digits })).total).toBe(0)
    expect((await call('list_transactions', { sameMerchantAs: UNKNOWN_ID })).total).toBe(0)
  })

  it('takes a search literally, with no wildcards', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    for (const name of ['SALE 50% OFF', 'SALE 50 OFF', 'A_B STORE', 'AXB STORE']) {
      await insertBankTransaction(ctx.db, accountId, { date: '2026-11-10', name, amountCents: 100 })
    }
    expect(names(await call('list_transactions', { search: '50%' }))).toEqual(['SALE 50% OFF'])
    expect(names(await call('list_transactions', { search: 'a_b' }))).toEqual(['A_B STORE'])
  })

  it('pages through results while reporting the full total', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    for (const day of ['01', '02', '03']) {
      await insertBankTransaction(ctx.db, accountId, {
        date: `2026-11-${day}`,
        name: `Day ${day}`,
        amountCents: 100,
      })
    }

    const page = await call('list_transactions', { limit: 1, offset: 1 })

    expect(page.total).toBe(3)
    expect(names(page)).toEqual(['Day 02'])
  })

  it('pages a search and a merchant in the database, with the full total', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    // 300 days of a gym and a cafe, alternating, newest on Nov 10.
    await ctx.db.query(
      `INSERT INTO transactions (account_id, provider_transaction_id, date, name, amount_cents)
       SELECT $1, 'bulk-' || n, DATE '2026-11-10' - n,
         CASE WHEN n % 2 = 0 THEN 'CITY GYM ' || n ELSE 'CORNER CAFE ' || n END, 100 + n
       FROM generate_series(0, 299) AS n`,
      [accountId],
    )
    const gym = (await call('list_transactions', { search: 'city gym', limit: 1 })).transactions[0]!

    // Every list query is paged in SQL, so a search never reads the whole history.
    const sent: string[] = []
    const watched = {
      query: (text: string, params: unknown[]) => {
        sent.push(text)
        return ctx.db.query(text, params)
      },
    } as unknown as Db
    for (const filter of [{ search: 'city gym' }, { sameMerchantAs: gym.id }]) {
      sent.length = 0
      const page = await listTransactions(
        watched,
        transactionFilterSchema.parse({ ...filter, limit: 10, offset: 20 }),
      )
      expect(page.total).toBe(150)
      expect(page.transactions).toHaveLength(10)
      // Newest first: the 21st gym charge is 40 days before Nov 10.
      expect(page.transactions[0]!.date).toBe('2026-10-01')
      const lists = sent.filter((text) => text.includes('FROM transactions t LEFT JOIN categories'))
      expect(lists).toHaveLength(1)
      expect(lists[0]).toMatch(/LIMIT \$\d+ OFFSET \$\d+/)
    }
  })

  it('rejects a date that does not exist', async () => {
    const error = await callError('list_transactions', { start: '2026-02-30' })
    expect(error.message).toBe('start: Use a real date as YYYY-MM-DD')
  })
})

describe('changing transactions', () => {
  it('reports an unknown transaction as not found', async () => {
    const error = await callError('update_transaction', { id: UNKNOWN_ID, note: 'x' })
    expect(error).toMatchObject({ code: 'not_found', message: 'Transaction not found' })
  })

  it('refuses a category that does not exist', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const id = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'Gym',
      amountCents: 4000,
    })
    const error = await callError('update_transaction', { id, categoryId: UNKNOWN_ID })
    expect(error).toMatchObject({ code: 'invalid_input', message: 'That category does not exist' })
  })

  it('clears a note when it is set to null', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const id = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'Gym',
      amountCents: 4000,
    })
    await call('update_transaction', { id, note: 'annual fee' })

    const updated = await call('update_transaction', { id, note: null })

    expect(updated.note).toBeNull()
  })

  it('re-sorts a hand-entered transaction when its description changes', async () => {
    const wallet = await call('create_account', {
      name: 'Wallet',
      type: 'depository',
      balanceCents: 0,
    })
    const food = await call('create_category', { name: 'Food' })
    await call('create_rule', { pattern: 'taco', categoryId: food.id })
    const tx = await call('create_transaction', {
      accountId: wallet.id,
      date: '2026-11-16',
      name: 'Lunch',
      amountCents: 1200,
    })
    expect(tx.categoryId).toBeNull()

    const renamed = await call('update_transaction', {
      id: tx.id,
      name: 'Taco truck',
      date: '2026-11-15',
    })

    expect(renamed).toMatchObject({
      categoryId: food.id,
      categorySource: 'rule',
      date: '2026-11-15',
    })
  })
})

describe('entering transactions by hand', () => {
  it('keeps a category chosen when the transaction is entered', async () => {
    const wallet = await call('create_account', {
      name: 'Wallet',
      type: 'depository',
      balanceCents: 0,
      currency: 'EUR',
    })
    const gifts = await call('create_category', { name: 'Gifts' })

    const tx = await call('create_transaction', {
      accountId: wallet.id,
      date: '2026-11-16',
      name: 'Flowers',
      amountCents: 3000,
      categoryId: gifts.id,
      note: 'for mom',
    })

    expect(tx).toMatchObject({
      categoryId: gifts.id,
      categorySource: 'manual',
      currency: 'EUR',
      note: 'for mom',
      manual: true,
    })
  })

  it('refuses an account or a category that does not exist', async () => {
    const wallet = await call('create_account', {
      name: 'Wallet',
      type: 'depository',
      balanceCents: 0,
    })
    const base = { date: '2026-11-16', name: 'Cash', amountCents: 100 }

    const noAccount = await callError('create_transaction', { ...base, accountId: UNKNOWN_ID })
    const noCategory = await callError('create_transaction', {
      ...base,
      accountId: wallet.id,
      categoryId: UNKNOWN_ID,
    })

    expect(noAccount.message).toBe('That account does not exist')
    expect(noCategory.message).toBe('That category does not exist')
    expect((await call('list_transactions')).total).toBe(0)
  })

  it('reports an unknown transaction as not found when deleting', async () => {
    expect((await callError('delete_transaction', { id: UNKNOWN_ID })).code).toBe('not_found')
  })
})
