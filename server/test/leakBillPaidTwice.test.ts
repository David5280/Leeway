// A bill the owner tracks, paid twice in one cycle, is told once: as a
// charge made twice, or as the bill's change when charges made twice notify
// no one, and a refund or time settles it (doublePaidBills.ts).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listAlerts } from '../src/domain/alerts.js'
import { hideHomeAlert, listHomeAlerts } from '../src/domain/notifications/homeAlerts.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import {
  NOTIFICATION_KINDS,
  updateNotificationSettings,
} from '../src/domain/notifications/settings.js'
import { getSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import { chargedTwice, everyday } from './fixtures/leaks.js'
import { createTestContext, insertBankTransaction, resetData } from './helpers.js'

describe('a tracked bill paid twice', () => {
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

  /** A $15.49 Netflix bill, tracked since September, paid twice this month. */
  async function billPaidTwice() {
    const { accountId } = await everyday(ctx.db)
    await earlierNetflix(accountId)
    await chargedTwice(ctx.db, accountId)
    await trackNetflix()
    return accountId
  }

  /** Netflix at $15.49 on the 3rd of August, September and October. */
  async function earlierNetflix(accountId: string) {
    for (const date of ['2026-08-03', '2026-09-03', '2026-10-03']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'NETFLIX.COM 4417',
        merchantName: 'Netflix',
        amountCents: 1549,
      })
    }
  }

  /** The Netflix bill at $15.49, tracked since September. */
  async function trackNetflix() {
    const bill = await call('create_bill', {
      name: 'Netflix',
      amountCents: 1549,
      cadence: 'month',
      anchorDate: '2026-11-03',
      matchPattern: 'netflix',
    })
    await ctx.db.query(`UPDATE bills SET created_at = '2026-09-01T12:00:00Z'`)
    return bill.id
  }

  const usual = async (billId: string) =>
    (await call('list_bills')).bills.find((bill) => bill.id === billId)!.amountCents

  it('is told once, as a charge made twice, not also as a bill change', async () => {
    await billPaidTwice()
    const kinds = (await call('list_alerts', {})).map((alert) => alert.kind)
    expect(kinds).toContain('duplicate_charge')
    expect(kinds).not.toContain('bill_change')
  })

  it('notifies once', async () => {
    await billPaidTwice()
    await refreshInbox(ctx)
    const { rows } = await ctx.db.query<{ kind: string }>(
      `SELECT kind FROM notifications WHERE kind IN ('duplicate_charge', 'bill_change')`,
    )
    expect(rows).toEqual([{ kind: 'duplicate_charge' }])
  })

  it('notifies as a bill change when charges made twice notify no one', async () => {
    await billPaidTwice()
    await updateNotificationSettings(ctx.db, {
      kinds: Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, kind === 'bill_change'])),
    })
    await refreshInbox(ctx)
    const { rows } = await ctx.db.query<{ kind: string; message: string }>(
      `SELECT kind, message FROM notifications WHERE kind IN ('duplicate_charge', 'bill_change')`,
    )
    expect(rows).toEqual([{ kind: 'bill_change', message: 'Netflix was $30.98, usually $15.49.' }])
  })

  it('tells a new price paid twice at the price, and dismissing takes that price', async () => {
    const { accountId } = await everyday(ctx.db)
    await earlierNetflix(accountId)
    for (const date of ['2026-11-03', '2026-11-04']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'NETFLIX.COM 4417',
        merchantName: 'Netflix',
        amountCents: 1999,
      })
    }
    const billId = await trackNetflix()
    const alerts = await call('list_alerts', {})
    expect(alerts.map((alert) => alert.message)).toEqual([
      'Netflix was $19.99, usually $15.49.',
      'Netflix charged $19.99 twice, on Nov 3 and Nov 4.',
    ])
    await call('hide_home_alert', { kind: 'bill_change', accountId, billId })
    expect(await usual(billId)).toBe(1999)
  })

  it('hides a bill change for a cycle only paid twice, keeping the usual amount', async () => {
    const accountId = await billPaidTwice()
    const settings = await getSettings(ctx.db)
    // As the inbox sees it with charges made twice turned off.
    const alerts = await listAlerts(ctx.db, settings, '2026-11-17', [], { doublesTold: false })
    const change = alerts.find((alert) => alert.kind === 'bill_change')!
    expect(change.message).toBe('Netflix was $30.98, usually $15.49.')
    const now = ctx.now()
    await hideHomeAlert(
      ctx.db,
      alerts,
      { kind: 'bill_change', accountId, billId: change.bill!.id },
      now,
    )
    expect(await usual(change.bill!.id)).toBe(1549)
    const home = await listHomeAlerts(ctx.db, alerts, [], now)
    expect(home.alerts.map((alert) => alert.kind)).not.toContain('bill_change')
  })

  it('stays told once after a refund, and once the charge is old news', async () => {
    const accountId = await billPaidTwice()
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-08',
      name: 'NETFLIX.COM 4417',
      merchantName: 'Netflix',
      amountCents: -1549,
    })
    expect(await call('list_alerts', {})).toEqual([])
    ctx.setNow(new Date('2026-12-02T18:00:00Z'))
    expect((await call('list_alerts', {})).filter((alert) => alert.kind === 'bill_change')).toEqual(
      [],
    )
  })
})
