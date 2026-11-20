// Tracking a recurring charge as a bill in one step (trackRecurring.ts), for
// the owner's one tap and an assistant's one call, and Undo by deleting it.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext
const owner = actionCaller(() => ctx)
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

/** Comcast at $80, $82 and $80 on the 20th of the last three months, and a paycheck. */
async function comcastHistory(): Promise<string> {
  const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday', mask: '4417' })
  for (const [date, amountCents] of [
    ['2026-08-20', 8000],
    ['2026-09-20', 8200],
    ['2026-10-20', 8000],
  ] as const) {
    await insertBankTransaction(ctx.db, accountId, { date, name: 'COMCAST', amountCents })
  }
  for (const date of ['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13']) {
    await insertBankTransaction(ctx.db, accountId, {
      date,
      name: 'ACME PAYROLL',
      amountCents: -250000,
    })
  }
  return accountId
}

describe('track_recurring', () => {
  it('makes the bill from the charges found, in one step, and Undo brings the suggestion back', async () => {
    const accountId = await comcastHistory()
    const [comcast] = (await owner.call('find_recurring')).filter((s) => s.direction === 'out')
    expect(comcast).toMatchObject({ name: 'Comcast', accountId })

    const bill = await owner.call('track_recurring', { key: comcast!.key })
    expect(bill).toMatchObject({
      name: 'Comcast',
      kind: 'subscription',
      // The median of $80, $82 and $80.
      amountCents: 8000,
      cadence: 'month',
      anchorDate: '2026-11-20',
      nextDueDate: '2026-11-20',
      matchPattern: comcast!.key,
      accountId,
      autopay: false,
      reads: 'bank_text',
    })
    expect((await owner.call('list_bills')).bills.map((b) => b.name)).toEqual(['Comcast'])
    expect((await owner.call('find_recurring')).map((s) => s.name)).not.toContain('Comcast')

    // Undo: the bill goes, and the charge is suggested again.
    await owner.call('delete_bill', { id: bill.id })
    expect((await owner.call('list_bills')).bills).toEqual([])
    expect((await owner.call('find_recurring')).map((s) => s.name)).toContain('Comcast')
  })

  it('stays editable like any bill', async () => {
    await comcastHistory()
    const bill = await owner.call('track_recurring', { key: 'comcast' })
    const changed = await owner.call('update_bill', { id: bill.id, amountCents: 9000 })
    expect(changed).toMatchObject({ amountCents: 9000, accountId: bill.accountId })
  })

  it('lets an assistant track by the key it was given, reading shown names', async () => {
    await comcastHistory()
    const [found] = (await assistant.call('find_recurring')).filter((s) => s.direction === 'out')
    const bill = await assistant.call('track_recurring', { key: found!.key })
    expect(bill).toMatchObject({ name: 'Comcast', amountCents: 8000, reads: 'shown_name' })
    expect(JSON.stringify(bill)).not.toContain('4417')
    expect((await assistant.call('find_recurring')).map((s) => s.name)).not.toContain('Comcast')
  })

  it('tracks only charges still suggested, and never a paycheck', async () => {
    await comcastHistory()
    expect((await owner.callError('track_recurring', { key: 'netflix' })).code).toBe('not_found')
    const paycheck = (await owner.call('find_recurring')).find((s) => s.direction === 'in')
    expect(paycheck).toBeDefined()
    expect((await owner.callError('track_recurring', { key: paycheck!.key })).code).toBe(
      'not_found',
    )
    await owner.call('track_recurring', { key: 'comcast' })
    // Tracked once: a second tap finds nothing left to track.
    expect((await owner.callError('track_recurring', { key: 'comcast' })).code).toBe('not_found')
  })
})
