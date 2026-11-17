import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-17, in UTC.
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

const netflix = {
  name: 'Netflix',
  kind: 'subscription',
  amountCents: 1549,
  cadence: 'month',
  anchorDate: '2026-01-20',
  matchPattern: 'netflix.com',
}

/** Monthly charges on the 20th, as a bank would describe them. */
async function chargeMonthly(accountId: string, name: string, months: string[], cents = 1549) {
  for (const month of months) {
    await insertBankTransaction(ctx.db, accountId, {
      date: `${month}-20`,
      name,
      amountCents: cents,
    })
  }
}

describe('bills', () => {
  it('adds a bill and lists it with its next due date and monthly cost', async () => {
    const created = await call('create_bill', { ...netflix, matchPattern: null })
    expect(created).toMatchObject({
      name: 'Netflix',
      autopay: false,
      categoryId: null,
      nextDueDate: '2026-11-20',
      status: 'due_soon',
      lastPaidDate: null,
      monthlyCents: 1549,
    })
    const listed = await call('list_bills')
    expect(listed.bills.map((b) => b.id)).toEqual([created.id])
    expect(listed).toMatchObject({ monthlyCents: 1549, subscriptionsMonthlyCents: 1549 })
  })

  it('finds the payment however the bank writes the merchant', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await chargeMonthly(accountId, 'NETFLIX.COM 8473 CA', ['2026-09', '2026-10'])
    // A refund and a charge on a hidden account do not count as paying.
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-15',
      name: 'NETFLIX.COM',
      amountCents: -1549,
    })
    const hidden = await insertBankAccount(ctx.db, { hidden: true })
    await chargeMonthly(hidden.accountId, 'NETFLIX.COM', ['2026-11'])

    const bill = await call('create_bill', { ...netflix, anchorDate: '2026-12-20' })
    expect(bill).toMatchObject({ lastPaidDate: '2026-10-20', lastPaidCents: 1549 })
  })

  it('flags a missed payment as overdue', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await chargeMonthly(accountId, 'Netflix', ['2026-09'])
    const bill = await call('create_bill', { ...netflix, anchorDate: '2026-09-20' })
    expect(bill).toMatchObject({ status: 'overdue', nextDueDate: '2026-10-20' })
  })

  it('changes only the fields given, and deletes', async () => {
    const bill = await call('create_bill', { ...netflix, autopay: true })
    const updated = await call('update_bill', { id: bill.id, amountCents: 1799 })
    expect(updated).toMatchObject({ amountCents: 1799, autopay: true, matchPattern: 'netflix.com' })
    expect(await call('delete_bill', { id: bill.id })).toEqual({ deleted: bill.id })
    expect((await call('list_bills')).bills).toEqual([])
    expect((await callError('delete_bill', { id: bill.id })).code).toBe('not_found')
    expect((await callError('update_bill', { id: bill.id, name: 'Gone' })).code).toBe('not_found')
  })

  it('refuses a pattern with no letters, which would match every charge', async () => {
    const error = await callError('create_bill', { ...netflix, matchPattern: '1234' })
    expect(error.message).toContain('Use some letters from the merchant name')
  })

  it('keeps a bill when its category is deleted', async () => {
    const category = await call('create_category', { name: 'Streaming' })
    const bill = await call('create_bill', { ...netflix, categoryId: category.id })
    await call('delete_category', { id: category.id })
    expect((await call('list_bills')).bills[0]).toMatchObject({ id: bill.id, categoryId: null })
  })
})

describe('recurring charges', () => {
  async function history() {
    const { accountId } = await insertBankAccount(ctx.db)
    await chargeMonthly(accountId, 'SPOTIFY P1A2', ['2026-08', '2026-09', '2026-10'], 1199)
    await chargeMonthly(accountId, 'NETFLIX.COM 8473', ['2026-08', '2026-09', '2026-10'])
    // Pending and excluded transactions are not history yet.
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-01',
      name: 'HULU',
      amountCents: 999,
      pending: true,
    })
  }

  it('suggests repeating charges that are not tracked yet', async () => {
    await history()
    await call('create_bill', netflix)
    // A bill with no pattern cannot match a suggestion.
    await call('create_bill', { ...netflix, name: 'Gym', matchPattern: null })
    const found = await call('find_recurring')
    expect(found).toMatchObject([
      { key: 'spotify p a', name: 'SPOTIFY P1A2', cadence: 'month', suggestedKind: 'subscription' },
    ])
  })

  it('tracks a suggestion with its key as the pattern', async () => {
    await history()
    const [first] = await call('find_recurring')
    const bill = await call('create_bill', {
      name: first!.name,
      amountCents: first!.typicalAmountCents,
      cadence: first!.cadence,
      anchorDate: first!.nextDate,
      matchPattern: first!.key,
    })
    expect(bill.lastPaidDate).toBe('2026-10-20')
    expect((await call('find_recurring')).map((s) => s.key)).not.toContain(first!.key)
  })

  it('stops suggesting a dismissed charge', async () => {
    await history()
    expect(await call('dismiss_recurring', { key: 'spotify p a' })).toEqual({
      dismissed: 'spotify p a',
    })
    // Dismissing twice is fine.
    await call('dismiss_recurring', { key: 'spotify p a' })
    expect((await call('find_recurring')).map((s) => s.key)).toEqual(['netflix com'])
  })
})
