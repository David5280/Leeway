// Tracking a recurring charge as a bill in one step (trackRecurring.ts), for
// the owner's one tap and an assistant's one call, and Undo by deleting it.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { listBillChanges } from '../src/domain/billChangeSource.js'
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

  it('remembers when the amount varies, so a utility never alerts on its own swings', async () => {
    const accountId = await comcastHistory()
    for (const [date, amountCents] of [
      ['2026-08-25', 6000],
      ['2026-09-25', 9000],
      ['2026-10-25', 7500],
    ] as const) {
      await insertBankTransaction(ctx.db, accountId, { date, name: 'CITY POWER', amountCents })
    }
    const found = await owner.call('find_recurring')
    const power = found.find((s) => s.name === 'City Power')!
    expect(power.amountVaries).toBe(true)
    await owner.call('track_recurring', { key: power.key })
    await owner.call('track_recurring', { key: 'comcast' })
    const { rows } = await ctx.db.query<{ name: string; amount_varies: boolean }>(
      'SELECT name, amount_varies FROM bills ORDER BY name',
    )
    expect(rows).toEqual([
      { name: 'City Power', amount_varies: true },
      { name: 'Comcast', amount_varies: false },
    ])
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

describe('a key an assistant was given before names were read more closely', () => {
  // Shown as "To Wilhelmina Ashcombe" now, and "To Wilhelmina Ashcombe via Zelle" before.
  const EARLIER = 'to wilhelmina ashcombe via zelle'

  /** $25 to a friend through Zelle on the 5th of the last three months. */
  async function zelleHistory(): Promise<void> {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday', mask: '4417' })
    for (const date of ['2026-08-05', '2026-09-05', '2026-10-05']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'Payment to Wilhelmina Ashcombe via Zelle',
        amountCents: 2500,
        detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
      })
    }
  }

  it('still tracks or dismisses the series it named', async () => {
    await zelleHistory()
    const [found] = await assistant.call('find_recurring')
    expect(found!.key).toBe('to wilhelmina ashcombe')

    const bill = await assistant.call('track_recurring', { key: EARLIER })
    expect(bill).toMatchObject({ amountCents: 2500, reads: 'shown_name' })
    await owner.call('delete_bill', { id: bill.id })
    await assistant.call('dismiss_recurring', { key: EARLIER })
    expect(await assistant.call('find_recurring')).toEqual([])
  })

  it('keeps a bill or a rule it saved from the earlier name matching', async () => {
    await zelleHistory()
    const bill = await assistant.call('create_bill', {
      name: 'Wilhelmina',
      kind: 'bill',
      amountCents: 2000,
      cadence: 'month',
      anchorDate: '2026-11-05',
      matchPattern: 'To Wilhelmina Ashcombe via Zelle',
    })
    expect(await assistant.call('find_recurring')).toEqual([])
    // Its payments count as paid, and as charges its amount is checked against.
    const {
      bills: [listed],
    } = await owner.call('list_bills', {})
    expect(listed).toMatchObject({ lastPaidDate: '2026-10-05', lastPaidCents: 2500 })
    await ctx.db.query(`UPDATE bills SET created_at = '2026-09-01' WHERE id = $1`, [bill.id])
    expect(await listBillChanges(ctx.db, 'UTC', '2026-10-20')).toMatchObject([
      { kind: 'settled', amountCents: 2500 },
    ])

    const pattern = { field: 'merchant', matchType: 'contains', pattern: 'Ashcombe via Zelle' }
    expect(await assistant.call('preview_rule', pattern)).toMatchObject({ matchCount: 3 })
    const { id: categoryId } = await owner.call('create_category', {
      name: 'Gifts',
      kind: 'expense',
    })
    await assistant.call('create_rule', { ...pattern, categoryId })
    const { transactions } = await owner.call('list_transactions', {})
    expect(transactions.map((tx) => tx.categoryId)).toEqual([categoryId, categoryId, categoryId])
  })
})
