// The inbox against a real database: news from each rule, kept once,
// cleared when it ends, back as new only after a while, and pruned. Every
// push goes to a fake.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  KEEP_DAYS,
  listNotifications,
  moveSubjects,
  pruneInbox,
  REARM_AFTER_MS,
  unreadCount,
} from '../src/domain/notifications/inbox.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  getNotificationSettings,
  kindsOn,
  NOTIFICATION_KINDS,
  updateNotificationSettings,
} from '../src/domain/notifications/settings.js'
import { DAY_MS, MINUTE_MS } from '../src/lib/time.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const NOW = new Date('2026-11-17T18:00:00Z')
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call } = actionCaller(() => ctx)
const later = (ms: number) => new Date(ctx.now().getTime() + ms)

beforeAll(async () => {
  ctx = await createTestContext({ now: NOW })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
})

async function setBalance(accountId: string, cents: number) {
  await ctx.db.query('UPDATE accounts SET balance_cents = $2 WHERE id = $1', [accountId, cents])
}

/** The kinds the owner has on, as the inbox and the bell read them. */
const on = async () => kindsOn(await getNotificationSettings(ctx.db))
const unread = async () => unreadCount(ctx.db, await on())

const inbox = async () =>
  (await listNotifications(ctx.db, await on())).map(
    ({ kind, title, message, readAt, resolvedAt }) => ({
      kind,
      title,
      message,
      read: readAt !== null,
      resolved: resolvedAt !== null,
    }),
  )

describe('the rules, from stored data', () => {
  it('adds an overdrawn account once, however often it is checked', async () => {
    await insertBankAccount(ctx.db, { name: 'Everyday', subtype: 'checking', balanceCents: -4210 })
    await refreshInbox(ctx)
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([
      {
        kind: 'overdrawn',
        title: 'Overdrawn',
        message: 'Test Everyday is overdrawn by $42.10.',
        read: false,
        resolved: false,
      },
    ])
    expect(await unread()).toBe(1)
  })

  it('takes the latest wording without making it news again', async () => {
    const { accountId } = await insertBankAccount(ctx.db, {
      name: 'Everyday',
      subtype: 'checking',
      balanceCents: -4210,
    })
    await refreshInbox(ctx)
    await call('mark_notifications_read', {})
    await setBalance(accountId, -9000)
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([
      expect.objectContaining({ message: 'Test Everyday is overdrawn by $90.', read: true }),
    ])
  })

  it('clears a condition that ended, and brings it back as new only after an hour', async () => {
    const { accountId } = await insertBankAccount(ctx.db, {
      name: 'Everyday',
      subtype: 'checking',
      balanceCents: -100,
    })
    await refreshInbox(ctx)
    await call('mark_notifications_read', {})
    await setBalance(accountId, 50_000)
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([expect.objectContaining({ resolved: true, read: true })])
    expect(await unread()).toBe(0)

    // Back within the hour: it picks up where it was, still read, no new push owed.
    ctx.setNow(later(REARM_AFTER_MS - MINUTE_MS))
    await setBalance(accountId, -100)
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([expect.objectContaining({ resolved: false, read: true })])

    // Cleared again, and back after more than an hour: news again.
    await setBalance(accountId, 50_000)
    await refreshInbox(ctx)
    ctx.setNow(later(REARM_AFTER_MS + MINUTE_MS))
    await setBalance(accountId, -100)
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([expect.objectContaining({ resolved: false, read: false })])
    const { rows } = await ctx.db.query('SELECT push_state, created_at FROM notifications')
    expect(rows).toEqual([{ push_state: 'pending', created_at: ctx.now() }])
  })

  it('hides a kind turned off and its count, adds nothing, and shows what is true when back on', async () => {
    const { accountId } = await insertBankAccount(ctx.db, {
      subtype: 'checking',
      balanceCents: -100,
    })
    await refreshInbox(ctx)
    expect(await unread()).toBe(1)
    await updateNotificationSettings(ctx.db, { kinds: { overdrawn: false } })
    await setBalance(accountId, 50_000)
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: -500 })
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([])
    expect(await unread()).toBe(0)
    // Nothing checked it while off, so it is not marked cleared, and nothing new was added.
    const { rows } = await ctx.db.query('SELECT resolved_at FROM notifications')
    expect(rows).toEqual([{ resolved_at: null }])

    ctx.setNow(later(MINUTE_MS))
    await updateNotificationSettings(ctx.db, { kinds: { overdrawn: true } })
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([
      expect.objectContaining({ kind: 'overdrawn', read: false, resolved: false }),
      expect.objectContaining({ kind: 'overdrawn', read: false, resolved: true }),
    ])
  })

  it('counts an unread notification on the bell even once it has cleared, as the inbox shows it', async () => {
    const { accountId } = await insertBankAccount(ctx.db, {
      subtype: 'checking',
      balanceCents: -100,
    })
    await refreshInbox(ctx)
    await setBalance(accountId, 50_000)
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([expect.objectContaining({ read: false, resolved: true })])
    expect(await unread()).toBe(1)
  })

  it('adds a low balance, an over-limit card and an overdraft fee', async () => {
    await insertBankAccount(ctx.db, { name: 'Bills', subtype: 'checking', balanceCents: 4000 })
    const { accountId: card } = await insertBankAccount(ctx.db, {
      name: 'Travel card',
      type: 'credit',
      balanceCents: 120_000,
    })
    await ctx.db.query('UPDATE accounts SET credit_limit_cents = 100000 WHERE id = $1', [card])
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Spare', subtype: 'checking' })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-16',
      name: 'OVERDRAFT FEE',
      amountCents: 3500,
    })
    await refreshInbox(ctx)
    expect((await inbox()).map((item) => item.title).sort()).toEqual([
      'Low balance',
      'Over credit limit',
      'Overdraft fee',
    ])
  })

  it('adds a category over its budget, once for the period', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    const food = await call('create_category', { name: 'Groceries', budgetCents: 10_000 })
    const tx = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'KING SOOPERS',
      amountCents: 12_000,
    })
    await call('update_transaction', { id: tx, categoryId: food.id })
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([
      expect.objectContaining({
        kind: 'over_budget',
        title: 'Over budget',
        message: 'Groceries is $20 over its $100 budget.',
      }),
    ])
    const { rows } = await ctx.db.query('SELECT subject, link FROM notifications')
    expect(rows).toEqual([{ subject: `${food.id}:2026-11-01`, link: `/budgets/${food.id}` }])
  })

  it('adds a bill due soon, by the days chosen', async () => {
    await call('create_bill', {
      name: 'Rent',
      amountCents: 180_000,
      cadence: 'month',
      anchorDate: '2026-11-20',
    })
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([])
    await updateNotificationSettings(ctx.db, { billDueDays: 3 })
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([
      expect.objectContaining({
        kind: 'bill_due',
        message: 'Rent is due in 3 days (Nov 20), usually $1,800.',
      }),
    ])
  })

  it('adds a bank that needs a new sign-in, and clears it once it is back', async () => {
    const { connectionId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await ctx.db.query(`UPDATE connections SET status = 'needs_reauth' WHERE id = $1`, [
      connectionId,
    ])
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([
      expect.objectContaining({
        kind: 'bank_login',
        message: 'Test Bank asks you to sign in again before Leeway can update its accounts.',
      }),
    ])
    await ctx.db.query(`UPDATE connections SET status = 'active' WHERE id = $1`, [connectionId])
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([expect.objectContaining({ resolved: true })])
  })
})

describe('kinds turned off', () => {
  it('adds nothing, and clears nothing, with every kind off', async () => {
    const { connectionId } = await insertBankAccount(ctx.db, {
      subtype: 'checking',
      balanceCents: -100,
    })
    await ctx.db.query(`UPDATE connections SET status = 'needs_reauth' WHERE id = $1`, [
      connectionId,
    ])
    await refreshInbox(ctx)
    expect(await inbox()).toHaveLength(2)
    const off = Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, false]))
    await updateNotificationSettings(ctx.db, { kinds: off })
    await ctx.db.query('DELETE FROM accounts')
    await ctx.db.query('DELETE FROM connections')
    await refreshInbox(ctx)
    // Hidden while off, and not marked cleared, since nothing checked them.
    expect(await inbox()).toEqual([])
    const { rows } = await ctx.db.query('SELECT resolved_at FROM notifications')
    expect(rows).toEqual([{ resolved_at: null }, { resolved_at: null }])
  })
})

describe('one account alert kind on alone', () => {
  /** Every kind off but these. */
  const onlyOn = (...kinds: string[]) =>
    updateNotificationSettings(ctx.db, {
      kinds: Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, kinds.includes(kind)])),
    })

  /** Netflix charged twice on Nov 3 and 4 on a checking account. */
  async function chargedTwice() {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    for (const date of ['2026-11-03', '2026-11-04']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'NETFLIX.COM',
        merchantName: 'Netflix',
        amountCents: 1549,
      })
    }
    return accountId
  }

  it('notifies a charge made twice with only that switch on', async () => {
    await chargedTwice()
    await onlyOn('duplicate_charge')
    await refreshInbox(ctx)
    expect((await inbox()).map((one) => one.kind)).toEqual(['duplicate_charge'])
  })

  it('notifies a price rise with only that switch on', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    for (const [date, amountCents] of [
      ['2026-08-12', 1099],
      ['2026-09-12', 1099],
      ['2026-10-12', 1099],
      ['2026-11-12', 1199],
    ] as const) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'SPOTIFY USA',
        merchantName: 'Spotify',
        amountCents,
      })
    }
    await onlyOn('price_rise')
    await refreshInbox(ctx)
    expect((await inbox()).map((one) => one.kind)).toEqual(['price_rise'])
  })

  it('notifies a bill change with only that switch on', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    for (const [date, amountCents] of [
      ['2026-09-16', 8000],
      ['2026-10-16', 8000],
      ['2026-11-16', 9500],
    ] as const) {
      await insertBankTransaction(ctx.db, accountId, { date, name: 'COMCAST', amountCents })
    }
    await call('create_bill', {
      name: 'Comcast',
      amountCents: 8000,
      cadence: 'month',
      anchorDate: '2026-11-16',
      matchPattern: 'comcast',
    })
    await ctx.db.query(`UPDATE bills SET created_at = '2026-09-01T12:00:00Z'`)
    await onlyOn('bill_change')
    await refreshInbox(ctx)
    expect((await inbox()).map((one) => one.kind)).toEqual(['bill_change'])
  })

  it('still notifies none of a kind left off', async () => {
    await chargedTwice()
    await onlyOn('price_rise')
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([])
  })
})

describe('large charges', () => {
  async function charge(accountId: string, more: { amountCents?: number; date?: string } = {}) {
    return insertBankTransaction(ctx.db, accountId, {
      date: more.date ?? '2026-11-17',
      name: 'BEST BUY 00012',
      merchantName: 'Best Buy',
      amountCents: more.amountCents ?? 60_000,
    })
  }

  it('adds a new charge at or over the threshold, naming the merchant in the app only', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday', subtype: 'checking' })
    await charge(accountId)
    await charge(accountId, { amountCents: 49_999 })
    await refreshInbox(ctx)
    expect(await inbox()).toEqual([
      expect.objectContaining({
        kind: 'large_transaction',
        message: 'Best Buy charged $600 to Test Everyday on Nov 17.',
      }),
    ])
    const { rows } = await ctx.db.query('SELECT push_body FROM notifications')
    expect(rows).toEqual([{ push_body: 'A large charge was made on Test Everyday.' }])
  })

  it('keeps a charge once as it goes from pending to posted', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    const pending = await charge(accountId)
    await ctx.db.query(`UPDATE transactions SET pending = true WHERE id = $1`, [pending])
    const { rows } = await ctx.db.query<{ id: string }>(
      'SELECT provider_transaction_id AS id FROM transactions WHERE id = $1',
      [pending],
    )
    await refreshInbox(ctx)
    // Posted: a new row that points back at the pending one, which may linger a moment.
    const posted = await charge(accountId)
    await ctx.db.query(
      'UPDATE transactions SET pending_provider_transaction_id = $2 WHERE id = $1',
      [posted, rows[0]!.id],
    )
    await refreshInbox(ctx)
    await ctx.db.query('DELETE FROM transactions WHERE id = $1', [pending])
    await refreshInbox(ctx)
    expect(await inbox()).toHaveLength(1)
  })

  it('follows a charge to a new id, kept once with its push state', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await charge(accountId)
    await charge(accountId, { date: '2026-11-16' })
    await refreshInbox(ctx)
    // The same charge on two days is also a duplicate_charge alert; only large charges move here.
    await ctx.db.query(`DELETE FROM notifications WHERE kind <> 'large_transaction'`)
    const { rows } = await ctx.db.query<{ subject: string }>(
      `UPDATE notifications SET push_state = 'sent' WHERE id = (
         SELECT id FROM notifications ORDER BY subject LIMIT 1)
       RETURNING subject`,
    )
    const { rows: others } = await ctx.db.query<{ subject: string }>(
      `SELECT subject FROM notifications WHERE subject <> $1`,
      [rows[0]!.subject],
    )
    const [sent, other] = [rows[0]!.subject, others[0]!.subject]
    // The pushed one now goes by the other's id, which is already kept.
    await moveSubjects(ctx.db, 'large_transaction', [
      { from: sent, to: other },
      { from: 'same', to: 'same' },
    ])
    const { rows: after } = await ctx.db.query(
      `SELECT subject, push_state FROM notifications ORDER BY subject`,
    )
    expect(after).toEqual([{ subject: other, push_state: 'sent' }])
  })

  it('leaves every notification as it was when no charge changed its id', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await charge(accountId)
    await refreshInbox(ctx)
    const kept = async () =>
      (await ctx.db.query(`SELECT subject, push_state FROM notifications ORDER BY subject`)).rows
    const before = await kept()
    await moveSubjects(ctx.db, 'large_transaction', [])
    await moveSubjects(ctx.db, 'large_transaction', [
      { from: before[0]!.subject, to: before[0]!.subject },
    ])
    expect(await kept()).toEqual(before)
  })

  it('leaves out old history, hidden accounts, hidden or imported charges, and transfers', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    const { accountId: hidden } = await insertBankAccount(ctx.db, { hidden: true })
    // Dated too long ago, as a newly linked bank's history is.
    await charge(accountId, { date: '2026-11-10' })
    // Dated recently, but reached Leeway days ago.
    const stale = await charge(accountId)
    await ctx.db.query(`UPDATE transactions SET created_at = $2 WHERE id = $1`, [
      stale,
      new Date(NOW.getTime() - 4 * DAY_MS),
    ])
    await charge(hidden)
    const excluded = await charge(accountId)
    await ctx.db.query('UPDATE transactions SET excluded = true WHERE id = $1', [excluded])
    const transfer = await charge(accountId)
    const moves = await call('create_category', { name: 'Moves', kind: 'transfer' })
    await call('update_transaction', { id: transfer, categoryId: moves.id })
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO imports (file_name, account_id, added) VALUES ('old.csv', $1, 1) RETURNING id`,
      [accountId],
    )
    const imported = await charge(accountId)
    await ctx.db.query('UPDATE transactions SET import_id = $2 WHERE id = $1', [
      imported,
      rows[0]!.id,
    ])
    // Entered by hand: no bank id.
    await ctx.db.query(
      `INSERT INTO transactions (account_id, date, name, amount_cents) VALUES ($1, '2026-11-17', 'Cash', 90000)`,
      [accountId],
    )
    await refreshInbox(ctx)
    // Several of these are the same charge on one day, which is a duplicate_charge alert instead.
    expect((await inbox()).filter((item) => item.kind === 'large_transaction')).toEqual([])
  })
})

describe('keeping the inbox tidy', () => {
  it(`prunes news older than ${KEEP_DAYS} days, but not a condition still going on`, async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: -100 })
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-17',
      name: 'BIG',
      amountCents: 90_000,
    })
    await refreshInbox(ctx)
    expect(await inbox()).toHaveLength(2)
    const all = [...NOTIFICATION_KINDS]
    expect(await pruneInbox(ctx.db, later((KEEP_DAYS - 1) * DAY_MS), all)).toBe(0)
    expect(await pruneInbox(ctx.db, later((KEEP_DAYS + 1) * DAY_MS), all)).toBe(1)
    expect((await inbox()).map((item) => item.kind)).toEqual(['overdrawn'])
    // A condition nothing checks any more, its kind turned off, goes too.
    const notOverdrawn = all.filter((kind) => kind !== 'overdrawn')
    expect(await pruneInbox(ctx.db, later((KEEP_DAYS + 1) * DAY_MS), notOverdrawn)).toBe(1)
  })
})

describe('notification settings', () => {
  it('starts with every kind on and sensible thresholds', async () => {
    expect(await getNotificationSettings(ctx.db)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    expect(Object.keys(DEFAULT_NOTIFICATION_SETTINGS.kinds)).toEqual([...NOTIFICATION_KINDS])
    expect(kindsOn(DEFAULT_NOTIFICATION_SETTINGS)).toEqual([...NOTIFICATION_KINDS])
    expect(DEFAULT_NOTIFICATION_SETTINGS).toMatchObject({
      overBudgetPercent: 100,
      billDueDays: 2,
      largeTransactionCents: 50_000,
      quietHours: { on: true, start: 22, end: 7 },
    })
  })

  it('merges a change into what is stored, keeping the rest', async () => {
    await updateNotificationSettings(ctx.db, { kinds: { low_balance: false } })
    const after = await updateNotificationSettings(ctx.db, { quietHours: { start: 21 } })
    expect(after.kinds.low_balance).toBe(false)
    expect(after.kinds.overdrawn).toBe(true)
    expect(after.quietHours).toEqual({ on: true, start: 21, end: 7 })
    expect(await getNotificationSettings(ctx.db)).toEqual(after)
  })

  it('keeps every field still valid from a stored document that no longer is', async () => {
    await ctx.db.query(`UPDATE notification_settings SET data = $1`, [
      JSON.stringify({
        kinds: { overdrawn: false, retired_kind: true },
        billDueDays: 5,
        overBudgetPercent: 9000,
        quietHours: { start: 20, end: 'dawn' },
      }),
    ])
    const settings = await getNotificationSettings(ctx.db)
    expect(settings.kinds.overdrawn).toBe(false)
    expect(settings.billDueDays).toBe(5)
    expect(settings.overBudgetPercent).toBe(100)
    expect(settings.quietHours).toEqual({ on: true, start: 22, end: 7 })
    await ctx.db.query(`UPDATE notification_settings SET data = 'null'`)
    expect(await getNotificationSettings(ctx.db)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })
})
