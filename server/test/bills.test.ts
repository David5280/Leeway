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
/** The same actions as an AI assistant calls them, over MCP. */
const assistant = actionCaller(() => ({ ...ctx, agent: true }))

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

// A well-formed id that matches no category.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

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

  it('refuses a category that does not exist, in plain words, when adding a bill', async () => {
    const error = await callError('create_bill', { ...netflix, categoryId: UNKNOWN_ID })
    expect(error).toMatchObject({ code: 'invalid_input', message: 'That category does not exist' })
    expect((await call('list_bills')).bills).toEqual([])
  })

  it('refuses a category that does not exist when changing a bill, and keeps the bill', async () => {
    const bill = await call('create_bill', netflix)
    const error = await callError('update_bill', { id: bill.id, categoryId: UNKNOWN_ID })
    expect(error).toMatchObject({ code: 'invalid_input', message: 'That category does not exist' })
    expect((await call('list_bills')).bills[0]).toMatchObject({ id: bill.id, categoryId: null })
  })
})

describe('bills an assistant adds', () => {
  /** Monthly gym dues whose bank text ends in the letters of an account's mask. */
  async function gymDues() {
    const { accountId } = await insertBankAccount(ctx.db, { mask: 'AB' })
    await chargeMonthly(accountId, 'ACCT GYM AB', ['2026-09', '2026-10'], 4000)
    await chargeMonthly(accountId, 'IRON GYM', ['2026-08'], 4000)
  }
  const gym = { ...netflix, name: 'Gym', anchorDate: '2026-12-20' }

  it("find their payment by the shown name, never the bank's text", async () => {
    await gymDues()
    const shown = await assistant.call('create_bill', { ...gym, matchPattern: 'iron gym' })
    expect(shown).toMatchObject({ reads: 'shown_name', lastPaidDate: '2026-08-20' })
    // The mask's letters find what letters found nowhere do: nothing.
    for (const matchPattern of ['acct gym ab', 'acct gym zq']) {
      const bill = await assistant.call('create_bill', { ...gym, matchPattern })
      expect(bill).toMatchObject({ reads: 'shown_name', lastPaidDate: null, lastPaidCents: null })
    }
    // The owner's own bill reads the bank's text, and finds the newest payment.
    const owners = await call('create_bill', { ...gym, matchPattern: 'acct gym ab' })
    expect(owners).toMatchObject({ reads: 'bank_text', lastPaidDate: '2026-10-20' })
    const listed = await call('list_bills')
    expect(listed.bills.map((b) => b.lastPaidDate)).toEqual([
      '2026-08-20',
      null,
      null,
      '2026-10-20',
    ])
  })

  it('count only what the owner bills count: no refund, no hidden account', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-15',
      name: 'NETFLIX.COM',
      amountCents: -1549,
    })
    const hidden = await insertBankAccount(ctx.db, { hidden: true })
    await chargeMonthly(hidden.accountId, 'NETFLIX.COM', ['2026-11'])
    expect(await assistant.call('create_bill', netflix)).toMatchObject({ lastPaidDate: null })
  })

  it("read shown names once an assistant changes an owner's pattern, and only then", async () => {
    await gymDues()
    const owners = await call('create_bill', { ...gym, matchPattern: 'acct gym ab' })
    const moved = await assistant.call('update_bill', { id: owners.id, amountCents: 4500 })
    expect(moved).toMatchObject({ reads: 'bank_text', lastPaidDate: '2026-10-20' })
    // The same pattern again is no change.
    const same = await assistant.call('update_bill', { id: owners.id, matchPattern: 'acct gym ab' })
    expect(same.reads).toBe('bank_text')
    const rewritten = await assistant.call('update_bill', { id: owners.id, matchPattern: 'gym ab' })
    expect(rewritten).toMatchObject({ reads: 'shown_name', lastPaidDate: null })
    // The owner changing it back leaves it reading what it does.
    const back = await call('update_bill', { id: owners.id, matchPattern: 'iron gym' })
    expect(back).toMatchObject({ reads: 'shown_name', lastPaidDate: '2026-08-20' })
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
      { key: 'spotify p a', name: 'Spotify', cadence: 'month', suggestedKind: 'subscription' },
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

  it('gives an assistant keys made from shown names, which track a charge', async () => {
    await history()
    const found = await assistant.call('find_recurring')
    expect(found.map((s) => s.key)).toEqual(['netflix com', 'spotify'])
    const [netflixSeries] = found
    const bill = await assistant.call('create_bill', {
      ...netflix,
      anchorDate: netflixSeries!.nextDate,
      matchPattern: netflixSeries!.key,
    })
    expect(bill).toMatchObject({ reads: 'shown_name', lastPaidDate: '2026-10-20' })
    expect((await call('find_recurring')).map((s) => s.key)).toEqual(['spotify p a'])
  })

  it('lets an assistant dismiss a charge only by the key it was given', async () => {
    await history()
    // The bank's key is not one an assistant was given, so it dismisses nothing.
    const raw = await assistant.callError('dismiss_recurring', { key: 'spotify p a' })
    expect(raw.code).toBe('not_found')
    expect(await assistant.call('dismiss_recurring', { key: 'spotify' })).toEqual({
      dismissed: 'spotify',
    })
    // The owner's app no longer suggests it either.
    expect((await call('find_recurring')).map((s) => s.key)).toEqual(['netflix com'])
  })

  it("never gives an assistant the bank's letters for a mask", async () => {
    const { accountId } = await insertBankAccount(ctx.db, { mask: 'AB' })
    await chargeMonthly(accountId, 'ACCT GYM AB', ['2026-08', '2026-09', '2026-10'], 4000)
    expect((await call('find_recurring')).map((s) => s.key)).toEqual(['acct gym ab'])
    const [series] = await assistant.call('find_recurring')
    // The shown name leaves the mask out, and so does the key made from it.
    expect(series!.key).toBe('acct gym')
    expect(JSON.stringify(series)).not.toMatch(/\bab\b/i)
    // A bill on the mask's letters tracks nothing, so the charge is still suggested.
    await assistant.call('create_bill', { ...netflix, matchPattern: 'acct gym ab' })
    expect(await assistant.call('find_recurring')).toHaveLength(1)
    expect((await assistant.callError('dismiss_recurring', { key: 'acct gym ab' })).code).toBe(
      'not_found',
    )
  })
})
