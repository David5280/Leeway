// A bill that cost more or less than usual (billChanges.ts): when it is news,
// how it reads, and how dismissing it or a second charge at the new amount
// makes that amount the usual one, through the same alerts and inbox as the
// account alerts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BILL_CHANGE_THRESHOLD, isAmountChange } from '../src/domain/billAmountChange.js'
import { billChangeAlert, billChangeOf, type WatchedBill } from '../src/domain/billChanges.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import { formatCents } from '../src/lib/money.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const TODAY = '2026-11-17'

const comcast = (charges: [string, number][], fields: Partial<WatchedBill> = {}): WatchedBill => ({
  id: 'bill-1',
  name: 'Comcast',
  amountCents: 8000,
  cadence: 'month',
  trackedOn: '2026-09-25',
  amountVaries: false,
  amountSetOn: null,
  charges: charges.map(([date, amountCents]) => ({ accountId: 'checking', date, amountCents })),
  ...fields,
})

describe('isAmountChange', () => {
  it('needs both the share and the cents of BILL_CHANGE_THRESHOLD', () => {
    expect(BILL_CHANGE_THRESHOLD).toEqual({ share: 0.1, cents: 300 })
    // $8 on $80 is 10%, and over $3.
    expect(isAmountChange(8000, 8800)).toBe(true)
    expect(isAmountChange(8000, 8799)).toBe(false)
    expect(isAmountChange(8000, 7200)).toBe(true)
    // 15% of $15, but only $2.25.
    expect(isAmountChange(1500, 1725)).toBe(false)
    // $20 on $500 is only 4%.
    expect(isAmountChange(50000, 52000)).toBe(false)
  })
})

describe('billChangeOf', () => {
  it('calls a charge well above or below the usual amount a change', () => {
    const higher = comcast([
      ['2026-11-16', 9500],
      ['2026-10-20', 8000],
    ])
    expect(billChangeOf(higher, TODAY)).toMatchObject({
      kind: 'changed',
      charge: { date: '2026-11-16', amountCents: 9500 },
    })
    const lower = comcast([
      ['2026-11-16', 6500],
      ['2026-10-20', 8000],
    ])
    expect(billChangeOf(lower, TODAY)?.kind).toBe('changed')
  })

  it('stays quiet under the threshold', () => {
    const near = comcast([
      ['2026-11-16', 8700],
      ['2026-10-20', 8000],
    ])
    expect(billChangeOf(near, TODAY)).toBeNull()
  })

  it('takes a second charge in a row at the new amount as the usual one', () => {
    const twice = comcast([
      ['2026-11-16', 9500],
      ['2026-10-20', 9500],
    ])
    expect(billChangeOf(twice, TODAY)).toMatchObject({ kind: 'settled', amountCents: 9500 })
  })

  it('adds up a cycle paid in parts, so a split payment is no change', () => {
    // $50 and then $10 in one cycle is the usual $60, not a $10 bill.
    const split = comcast(
      [
        ['2026-11-16', 1000],
        ['2026-11-14', 5000],
        ['2026-10-20', 6000],
      ],
      { amountCents: 6000 },
    )
    expect(billChangeOf(split, TODAY)).toBeNull()
    // The last cycle is added up too: $60 then, $95 now.
    const higher = comcast(
      [
        ['2026-11-16', 9500],
        ['2026-10-20', 1000],
        ['2026-10-18', 5000],
      ],
      { amountCents: 6000 },
    )
    expect(billChangeOf(higher, TODAY)).toMatchObject({
      kind: 'changed',
      charge: { date: '2026-11-16', amountCents: 9500 },
    })
    // A second payment this cycle reads as the cycle's total.
    const twice = comcast([
      ['2026-11-16', 5000],
      ['2026-11-14', 4500],
      ['2026-10-20', 8000],
    ])
    expect(billChangeOf(twice, TODAY)).toMatchObject({
      kind: 'changed',
      charge: { date: '2026-11-16', amountCents: 9500 },
    })
  })

  it('never alerts for a bill whose amount varies, such as power or water, but follows it', () => {
    const power = comcast(
      [
        ['2026-11-16', 14000],
        ['2026-10-20', 8000],
      ],
      { amountVaries: true },
    )
    // The latest $140 is above the $110 average, so it becomes the usual amount.
    expect(billChangeOf(power, TODAY)).toMatchObject({ kind: 'settled', amountCents: 14000 })
  })

  it('never calls the first charge since tracking a change', () => {
    const first = comcast(
      [
        ['2026-11-16', 9500],
        ['2026-10-20', 8000],
      ],
      { trackedOn: '2026-10-25' },
    )
    expect(billChangeOf(first, TODAY)).toBeNull()
    // Nor anything before tracking, or with one charge alone.
    expect(billChangeOf({ ...first, trackedOn: '2026-11-16' }, TODAY)).toBeNull()
    expect(billChangeOf(comcast([['2026-11-16', 9500]]), TODAY)).toBeNull()
  })

  it('compares nothing across a missed cycle, or a charge a cycle old', () => {
    const gap = comcast([
      ['2026-11-16', 9500],
      ['2026-08-20', 8000],
    ])
    expect(billChangeOf(gap, TODAY)).toBeNull()
    const stale = comcast([
      ['2026-08-20', 9500],
      ['2026-07-20', 8000],
    ])
    expect(billChangeOf({ ...stale, trackedOn: '2026-06-01' }, TODAY)).toBeNull()
  })

  it('words the change by bill and amounts, a higher one as a warning and a lower one as news', () => {
    const money = (cents: number) => formatCents(cents)
    const higher = billChangeOf(
      comcast([
        ['2026-11-16', 9500],
        ['2026-10-20', 8000],
      ]),
      TODAY,
    )
    if (higher?.kind !== 'changed') throw new Error('expected a change')
    expect(billChangeAlert(higher, 'Everyday', { money })).toEqual({
      kind: 'bill_change',
      severity: 'warning',
      accountId: 'checking',
      accountName: 'Everyday',
      amountCents: 9500,
      count: 1,
      date: '2026-11-16',
      message: 'Comcast was $95, usually $80.',
      summary: 'Comcast was $95, usually $80.',
      bill: { id: 'bill-1', name: 'Comcast', usualCents: 8000 },
    })
    const lower = { ...higher, charge: { ...higher.charge, amountCents: 6500 } }
    expect(billChangeAlert(lower, 'Everyday', { money }).severity).toBe('info')
  })
})

describe('bill change alerts', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  const { call } = actionCaller(() => ctx)

  beforeAll(async () => {
    ctx = await createTestContext()
  })
  afterAll(async () => {
    await ctx.db.end()
  })
  beforeEach(async () => {
    await resetData(ctx.db)
    ctx.setNow(new Date('2026-11-17T18:00:00Z'))
  })

  /**
   * Comcast tracked on Sep 25 at $80, then charged on Oct 20 and Nov 16, from
   * an account whose number ends 4417, which the bank also writes in its text.
   */
  async function trackedComcast(october: number, november: number) {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday', mask: '4417' })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-09-20',
      name: 'COMCAST 4417',
      amountCents: 8000,
    })
    const bill = await call('create_bill', {
      name: 'Comcast',
      amountCents: 8000,
      cadence: 'month',
      anchorDate: '2026-10-20',
      matchPattern: 'comcast',
    })
    await ctx.db.query(`UPDATE bills SET created_at = '2026-09-25T12:00:00Z' WHERE id = $1`, [
      bill.id,
    ])
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-10-20',
      name: 'COMCAST 4417',
      amountCents: october,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-16',
      name: 'COMCAST 4417',
      amountCents: november,
    })
    return { accountId, billId: bill.id }
  }

  const changes = async () =>
    (await call('list_alerts', {})).filter((alert) => alert.kind === 'bill_change')
  const usual = async (billId: string) =>
    (await call('list_bills')).bills.find((bill) => bill.id === billId)!.amountCents
  const inbox = async () =>
    (
      await ctx.db.query<{ title: string; push_body: string; resolved: boolean; message: string }>(
        `SELECT title, message, push_body, resolved_at IS NOT NULL AS resolved
       FROM notifications WHERE kind = 'bill_change'`,
      )
    ).rows

  it('alerts once for a charge above the usual amount, with no account number anywhere', async () => {
    const { accountId } = await trackedComcast(8000, 9500)
    const [alert] = await changes()
    expect(alert).toMatchObject({
      severity: 'warning',
      accountId,
      message: 'Comcast was $95, usually $80.',
    })
    await refreshInbox(ctx)
    await refreshInbox(ctx)
    // One notification for the charge, however often the inbox is brought up to date.
    expect(await inbox()).toEqual([
      {
        title: 'Bill changed',
        message: 'Comcast was $95, usually $80.',
        push_body: 'Comcast cost more than usual.',
        resolved: false,
      },
    ])
    expect(JSON.stringify([await changes(), await inbox()])).not.toContain('4417')
  })

  it('stays quiet under the threshold', async () => {
    await trackedComcast(8000, 8700)
    expect(await changes()).toEqual([])
  })

  it('takes the new amount as usual when the alert is dismissed in the inbox, and clears it', async () => {
    const { billId } = await trackedComcast(8000, 9500)
    await refreshInbox(ctx)
    const [notification] = (await call('list_notifications', {})).items
    await call('dismiss_notification', { id: notification!.id })
    expect(await usual(billId)).toBe(9500)
    expect(await changes()).toEqual([])
    await refreshInbox(ctx)
    expect(await inbox()).toMatchObject([{ resolved: true }])
  })

  it('takes the new amount as usual when the alert is hidden from home', async () => {
    const { accountId, billId } = await trackedComcast(8000, 6500)
    expect((await changes())[0]!.severity).toBe('info')
    await call('hide_home_alert', { kind: 'bill_change', accountId, billId })
    expect(await usual(billId)).toBe(6500)
    expect((await call('list_home_alerts')).alerts).toEqual([])
  })

  it('takes a second charge in a row at the new amount as usual, with no alert', async () => {
    const { billId } = await trackedComcast(9500, 9600)
    expect(await changes()).toEqual([])
    await refreshInbox(ctx)
    expect(await usual(billId)).toBe(9600)
    expect(await inbox()).toEqual([])
  })

  it('clears the alert when the next charge comes at the new amount', async () => {
    const { accountId, billId } = await trackedComcast(8000, 9500)
    await refreshInbox(ctx)
    expect(await inbox()).toMatchObject([{ resolved: false }])
    // December's charge at the new price: it is the usual one now.
    ctx.setNow(new Date('2026-12-17T18:00:00Z'))
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-12-16',
      name: 'COMCAST 4417',
      amountCents: 9500,
    })
    await refreshInbox(ctx)
    expect(await usual(billId)).toBe(9500)
    expect(await inbox()).toMatchObject([{ resolved: true }])
  })

  it('never fires on the first charge since tracking', async () => {
    const { billId } = await trackedComcast(8000, 9500)
    await ctx.db.query(`UPDATE bills SET created_at = '2026-10-25T12:00:00Z' WHERE id = $1`, [
      billId,
    ])
    expect(await changes()).toEqual([])
  })
})
