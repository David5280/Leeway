import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { categoryInputSchema, createCategory } from '../src/domain/categories.js'
import { merchantDisplayName, transactionDisplayName } from '../src/domain/transactionName.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

describe('transactionDisplayName', () => {
  const raw =
    'ONLINE TRANSFER TO BOK FINANCIAL, A DIVISION OF BOK ...2100 TRANSACTION#: 31677311100'

  it('names a paired transfer by its two accounts, money out first', () => {
    const transfer = { fromAccount: 'Chase Checking', toAccount: 'BOK Savings' }
    expect(transactionDisplayName({ name: raw, merchantName: null }, transfer)).toBe(
      'Chase Checking to BOK Savings',
    )
  })

  it('names a transfer with only one side here by the clean bank text', () => {
    expect(transactionDisplayName({ name: raw, merchantName: null })).toBe(
      'Transfer to BOK Financial',
    )
  })

  it('names the other person in a payment between people, the way read from the amount', () => {
    const tx = { name: 'Zelle from JANE DOE', merchantName: null }
    const person = { app: 'Zelle', counterparty: 'Jane Doe' }
    expect(transactionDisplayName({ ...tx, person: { ...person, direction: 'in' } })).toBe(
      'From Jane Doe',
    )
    expect(transactionDisplayName({ ...tx, person: { ...person, direction: 'out' } })).toBe(
      'To Jane Doe',
    )
  })

  it('falls back to the bank text when a payment between people names nobody', () => {
    const person = { app: 'Venmo', counterparty: null, direction: 'out' as const }
    expect(
      transactionDisplayName({ name: 'VENMO PAYMENT 1234567', merchantName: null, person }),
    ).toBe('Venmo Payment')
  })

  it('prefers the merchant name the bank gave, made readable, over its raw text', () => {
    expect(
      transactionDisplayName({ name: 'SQ *BLUE BOTTLE #12', merchantName: 'BLUE BOTTLE' }),
    ).toBe('Blue Bottle')
    expect(transactionDisplayName({ name: 'SQ *BLUE BOTTLE #12', merchantName: '  ' })).toBe(
      'Blue Bottle',
    )
  })

  it('names a merchant alone the same way, for lists of merchants', () => {
    expect(merchantDisplayName({ name: 'STARBUCKS STORE 12345', merchantName: null })).toBe(
      'Starbucks',
    )
  })
})

describe('transactions as listed', () => {
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

  /** Checking and savings, with a transfer between them. */
  async function transferBetween() {
    const checking = await insertBankAccount(ctx.db, { name: 'Total Checking' })
    const savings = await insertBankAccount(ctx.db, { name: 'Savings' })
    const out = await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-11-10',
      name: 'ONLINE TRANSFER TO SAV ...4417',
      amountCents: 50000,
    })
    const arrival = await insertBankTransaction(ctx.db, savings.accountId, {
      date: '2026-11-11',
      name: 'ONLINE TRANSFER FROM CHK ...9921',
      amountCents: -50000,
    })
    return { checking, savings, out, arrival }
  }

  it('names both sides of a transfer by their accounts and points each at the other', async () => {
    const { checking, savings, out, arrival } = await transferBetween()
    const { transactions } = await call('list_transactions', {})
    const byId = new Map(transactions.map((tx) => [tx.id, tx]))
    expect(byId.get(out)).toMatchObject({
      displayName: 'Test Total Checking to Test Savings',
      name: 'ONLINE TRANSFER TO SAV ...4417',
      transfer: { id: arrival, accountId: savings.accountId, date: '2026-11-11' },
    })
    expect(byId.get(arrival)).toMatchObject({
      displayName: 'Test Total Checking to Test Savings',
      transfer: { id: out, accountId: checking.accountId, accountName: 'Test Total Checking' },
    })
  })

  it('finds the other side even when the list is narrowed to one account', async () => {
    const { checking, arrival } = await transferBetween()
    const { transactions } = await call('list_transactions', { accountId: checking.accountId })
    expect(transactions).toHaveLength(1)
    expect(transactions[0]!.transfer?.id).toBe(arrival)
  })

  it('gives a lone transfer its clean bank name and no other side', async () => {
    const checking = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-11-10',
      name: 'ONLINE TRANSFER TO BOK FINANCIAL, A DIVISION OF BOK ...2100 TRANSACTION#: 316 11/19',
      amountCents: 50000,
    })
    const [tx] = (await call('list_transactions', {})).transactions
    expect(tx).toMatchObject({ displayName: 'Transfer to BOK Financial', transfer: null })
  })

  it('lists nothing, and pairs nothing, when there is nothing to list', async () => {
    expect(await call('list_transactions', {})).toEqual({ transactions: [], total: 0 })
  })

  it('files the other side again when the side added by hand is deleted', async () => {
    const transfers = await createCategory(
      ctx.db,
      categoryInputSchema.parse({ name: 'Transfers', kind: 'transfer' }),
    )
    const checking = await insertBankAccount(ctx.db)
    const savings = await insertBankAccount(ctx.db, { name: 'Savings' })
    const arrival = await insertBankTransaction(ctx.db, savings.accountId, {
      date: '2026-11-11',
      name: 'Deposit',
      amountCents: -2500,
    })
    const added = await call('create_transaction', {
      accountId: checking.accountId,
      date: '2026-11-10',
      name: 'Transfer to savings',
      amountCents: 2500,
    })
    expect(added.categoryId).toBe(transfers.id)
    expect(added.transfer?.id).toBe(arrival)
    const before = (await call('list_transactions', {})).transactions.find((t) => t.id === arrival)
    expect(before?.categoryId).toBe(transfers.id)

    await call('delete_transaction', { id: added.id })
    const [after] = (await call('list_transactions', {})).transactions
    expect(after).toMatchObject({ id: arrival, categoryId: null, transfer: null })
  })
})
