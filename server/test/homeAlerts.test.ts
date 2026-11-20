// Putting account alerts away, against a real database: hiding one from the
// home screen leaves the inbox alone, dismissing one in the inbox takes it off
// home too, and a condition put away comes back after a day if it still holds:
// on home, and in the inbox unread, but never pushed twice. A fee stays away,
// and so does a budget dismissed in the inbox. An alert that clears and comes
// back over an hour later is a new run of it and shows afresh; one that only
// flickers stays away. Every push goes to a fake.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import type { AccountAlert } from '../src/domain/accountAlerts.js'
import {
  REARM_AFTER_MS,
  RESURFACE_AFTER_MS,
  resurfaceDismissed,
} from '../src/domain/notifications/inbox.js'
import { refreshInbox, runNotifier } from '../src/domain/notifications/notifier.js'
import { updateNotificationSettings } from '../src/domain/notifications/settings.js'
import { accountAlertSubject, accountCandidates } from '../src/domain/notifications/words.js'
import { createToken } from '../src/domain/tokens.js'
import { buildApp } from '../src/http/app.js'
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../src/lib/time.js'
import { agentTools } from '../src/mcp/server.js'
import { saveSubscription } from '../src/push/subscriptions.js'
import { actionCaller } from './actionCaller.js'
import { FakePushSender } from './fakePush.js'
import { subscriptionFor } from './fixtures/push.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

/** 6 PM UTC, the owner's default time zone: well outside quiet hours. */
const NOW = new Date('2026-11-17T18:00:00Z')
const PHONE = 'https://web.push.apple.com/phone'

const push = new FakePushSender()
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call, callError } = actionCaller(() => ctx)
const at = (ms: number) => new Date(NOW.getTime() + ms)

beforeAll(async () => {
  ctx = await createTestContext({ now: NOW, push })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
  push.sent.length = 0
})

async function setBalance(accountId: string, cents: number) {
  await ctx.db.query('UPDATE accounts SET balance_cents = $2 WHERE id = $1', [accountId, cents])
}

/** A checking account $1 below zero: one overdrawn alert. */
async function overdrawn(name = 'Everyday'): Promise<string> {
  const { accountId } = await insertBankAccount(ctx.db, {
    name,
    subtype: 'checking',
    balanceCents: -100,
  })
  return accountId
}

/** A healthy checking account charged an overdraft fee on `date`: one fee alert. */
async function feeCharged(date = '2026-11-16'): Promise<string> {
  const { accountId } = await insertBankAccount(ctx.db, { name: 'Spare', subtype: 'checking' })
  await insertBankTransaction(ctx.db, accountId, { date, name: 'OVERDRAFT FEE', amountCents: 3500 })
  return accountId
}

/** Each home alert as "kind name", which reads plainly in a failing test. */
const home = async () =>
  (await call('list_home_alerts')).alerts.map((alert) => `${alert.kind} ${alert.accountName}`)

/** The inbox as the owner opens it (which brings it up to date). */
const inbox = async () => {
  const { items, unread } = await call('list_notifications')
  return { titles: items.map((item) => item.title), unread }
}

/** The one inbox item's id, after bringing the inbox up to date. */
const onlyItemId = async () => {
  const { items } = await call('list_notifications')
  expect(items).toHaveLength(1)
  return items[0]!.id
}

/** A run of the notifier at `ms` past NOW, as the timer makes one every few minutes. */
const notifyAt = async (ms: number) => {
  ctx.setNow(at(ms))
  await refreshInbox(ctx)
}

const hideCount = async () =>
  (await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM alert_hides')).rows[0]!.n

/** Whether the one stored notification is still dismissed, read without refreshing. */
const stillDismissed = async () =>
  (await ctx.db.query('SELECT dismissed_at IS NOT NULL AS away FROM notifications')).rows[0]!.away

describe('the subject an alert is kept under', () => {
  const alert = (fields: Partial<AccountAlert>): AccountAlert => ({
    kind: 'overdrawn',
    severity: 'urgent',
    accountId: 'acct-1',
    accountName: 'Everyday',
    amountCents: 100,
    count: 1,
    date: null,
    message: 'Everyday is overdrawn by $1.',
    summary: 'Everyday is overdrawn by $1.',
    ...fields,
  })

  it('is the account for a condition, and the account and latest date for a fee', () => {
    expect(accountAlertSubject(alert({ kind: 'overdrawn' }))).toBe('acct-1')
    expect(accountAlertSubject(alert({ kind: 'over_limit' }))).toBe('acct-1')
    expect(accountAlertSubject(alert({ kind: 'low_balance' }))).toBe('acct-1')
    expect(accountAlertSubject(alert({ kind: 'overdraft_fee', date: '2026-11-16' }))).toBe(
      'acct-1:2026-11-16',
    )
  })

  it('is the very subject each notification is stored under', () => {
    const alerts = [alert({}), alert({ kind: 'overdraft_fee', date: '2026-11-16' })]
    expect(accountCandidates(alerts).map((candidate) => candidate.subject)).toEqual(
      alerts.map(accountAlertSubject),
    )
  })
})

describe('the home screen', () => {
  it('shows every current alert while nothing is put away, as list_alerts does', async () => {
    expect(await call('list_home_alerts')).toEqual({ alerts: [], hidden: 0 })
    await overdrawn('Everyday')
    await feeCharged()
    expect(await call('list_home_alerts')).toEqual({
      alerts: await call('list_alerts'),
      hidden: 0,
    })
    expect(await home()).toEqual(['overdrawn Test Everyday', 'overdraft_fee Test Spare'])
  })

  it('only reads: a spent hide is cleared away by the notifier, not by home', async () => {
    const accountId = await overdrawn()
    await call('hide_home_alert', { kind: 'overdrawn', accountId })
    ctx.setNow(at(RESURFACE_AFTER_MS + 1))
    expect(await home()).toEqual(['overdrawn Test Everyday'])
    expect(await hideCount()).toBe(1)
    await refreshInbox(ctx)
    expect(await hideCount()).toBe(0)
  })
})

describe('hiding an alert from home', () => {
  it('takes it off home only: the inbox and assistants still have it, unread', async () => {
    const everyday = await overdrawn('Everyday')
    await overdrawn('Joint')
    expect(await inbox()).toEqual({ titles: ['Overdrawn', 'Overdrawn'], unread: 2 })

    expect(await call('hide_home_alert', { kind: 'overdrawn', accountId: everyday })).toEqual({
      hidden: true,
    })
    expect(await call('list_home_alerts')).toMatchObject({ hidden: 1 })
    expect(await home()).toEqual(['overdrawn Test Joint'])
    expect(await inbox()).toEqual({ titles: ['Overdrawn', 'Overdrawn'], unread: 2 })
    expect((await call('list_alerts')).map((alert) => alert.accountId)).toContain(everyday)
  })

  it('lasts a day while the condition holds, then shows again', async () => {
    const accountId = await overdrawn()
    await call('hide_home_alert', { kind: 'overdrawn', accountId })
    await notifyAt(RESURFACE_AFTER_MS)
    expect(await home()).toEqual([])
    ctx.setNow(at(RESURFACE_AFTER_MS + 1))
    expect(await home()).toEqual(['overdrawn Test Everyday'])
  })

  it('starts the day over when hidden again', async () => {
    const accountId = await overdrawn()
    await call('hide_home_alert', { kind: 'overdrawn', accountId })
    ctx.setNow(at(12 * HOUR_MS))
    await call('hide_home_alert', { kind: 'overdrawn', accountId })
    ctx.setNow(at(RESURFACE_AFTER_MS + HOUR_MS))
    expect(await home()).toEqual([])
    ctx.setNow(at(12 * HOUR_MS + RESURFACE_AFTER_MS + 1))
    expect(await home()).toEqual(['overdrawn Test Everyday'])
  })

  it('shows a condition that cleared and came back over an hour later, as the inbox does', async () => {
    // Hidden at 6 PM, fixed by 7, overdrawn again at 8:30: news again in both.
    await saveSubscription(ctx.db, subscriptionFor(PHONE))
    const accountId = await overdrawn()
    await call('hide_home_alert', { kind: 'overdrawn', accountId })
    await setBalance(accountId, 50_000)
    await notifyAt(HOUR_MS)
    await setBalance(accountId, -100)
    ctx.setNow(at(2.5 * HOUR_MS))
    // Before the notifier catches up, home already counts it as a new run.
    expect(await home()).toEqual(['overdrawn Test Everyday'])
    expect(await runNotifier(ctx)).toBe('sent')
    expect(await home()).toEqual(['overdrawn Test Everyday'])
    expect(await inbox()).toEqual({ titles: ['Overdrawn'], unread: 1 })
    expect(await hideCount()).toBe(0)
  })

  it('keeps a low balance that flickers across its warning hidden, as the inbox keeps it quiet', async () => {
    const { accountId } = await insertBankAccount(ctx.db, {
      name: 'Bills',
      subtype: 'checking',
      balanceCents: 4_000,
    })
    await call('hide_home_alert', { kind: 'low_balance', accountId })
    await setBalance(accountId, 20_000)
    await notifyAt(5 * MINUTE_MS)
    await setBalance(accountId, 4_000)
    ctx.setNow(at(10 * MINUTE_MS))
    expect(await home()).toEqual([])
    await notifyAt(10 * MINUTE_MS)
    await notifyAt(2 * HOUR_MS)
    expect(await home()).toEqual([])
    expect(await inbox()).toEqual({ titles: ['Low balance'], unread: 1 })
  })

  it('does the same with that kind of notification turned off', async () => {
    await updateNotificationSettings(ctx.db, { kinds: { overdrawn: false } })
    const accountId = await overdrawn()
    await call('hide_home_alert', { kind: 'overdrawn', accountId })
    // Back within the hour: still hidden.
    await setBalance(accountId, 50_000)
    await notifyAt(MINUTE_MS)
    await setBalance(accountId, -100)
    ctx.setNow(at(30 * MINUTE_MS))
    expect(await home()).toEqual([])
    // Gone for over an hour, then back: shows afresh.
    await setBalance(accountId, 50_000)
    await notifyAt(31 * MINUTE_MS)
    await notifyAt(2 * HOUR_MS)
    expect(await hideCount()).toBe(0)
    await setBalance(accountId, -100)
    expect(await home()).toEqual(['overdrawn Test Everyday'])
  })

  it('never outlives a newer run of the alert in the inbox', async () => {
    // Hidden while overdrawn notifications were off; turned on, it is news in the inbox.
    await updateNotificationSettings(ctx.db, { kinds: { overdrawn: false } })
    const accountId = await overdrawn()
    await call('hide_home_alert', { kind: 'overdrawn', accountId })
    await updateNotificationSettings(ctx.db, { kinds: { overdrawn: true } })
    ctx.setNow(at(MINUTE_MS))
    expect(await inbox()).toEqual({ titles: ['Overdrawn'], unread: 1 })
    expect(await home()).toEqual(['overdrawn Test Everyday'])
  })

  it('hides a fee for good, while a newer fee shows at once', async () => {
    const accountId = await feeCharged('2026-11-10')
    await call('hide_home_alert', { kind: 'overdraft_fee', accountId })
    await notifyAt(3 * DAY_MS)
    expect(await home()).toEqual([])

    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-20',
      name: 'OVERDRAFT FEE',
      amountCents: 3500,
    })
    expect(await home()).toEqual(['overdraft_fee Test Spare'])
    // The old fee's hide goes once it has been out of date for over an hour.
    await notifyAt(3 * DAY_MS + MINUTE_MS)
    await notifyAt(3 * DAY_MS + 2 * HOUR_MS)
    expect(await hideCount()).toBe(0)
  })

  it('keeps the order of the alerts it leaves', async () => {
    await overdrawn('Everyday')
    const joint = await overdrawn('Joint')
    await feeCharged()
    await call('hide_home_alert', { kind: 'overdrawn', accountId: joint })
    expect(await home()).toEqual(['overdrawn Test Everyday', 'overdraft_fee Test Spare'])
  })

  it('says an alert that is not current is not found, and checks what it is given', async () => {
    const accountId = await overdrawn()
    // Overdrawn, not low: the account has no low-balance alert to hide.
    expect(await callError('hide_home_alert', { kind: 'low_balance', accountId })).toMatchObject({
      code: 'not_found',
      message: 'Alert not found',
    })
    await setBalance(accountId, 50_000)
    expect((await callError('hide_home_alert', { kind: 'overdrawn', accountId })).code).toBe(
      'not_found',
    )
    expect(await hideCount()).toBe(0)
    for (const bad of [
      { kind: 'over_budget', accountId },
      { kind: 'overdrawn', accountId: 'not-an-id' },
      { kind: 'overdrawn', accountId, forever: true },
    ]) {
      expect((await callError('hide_home_alert', bad)).code).toBe('invalid_input')
    }
  })
})

describe('dismissing an alert in the inbox', () => {
  it('takes it off home at once, before the inbox is brought up to date again', async () => {
    await overdrawn('Everyday')
    await overdrawn('Joint')
    const { items } = await call('list_notifications')
    const joint = items.find((item) => item.message.includes('Joint'))!
    await call('dismiss_notification', { id: joint.id })
    expect(await home()).toEqual(['overdrawn Test Everyday'])
  })

  it('brings a condition still going on back after a day: on home, and unread in the inbox', async () => {
    await overdrawn()
    await call('dismiss_notification', { id: await onlyItemId() })
    ctx.setNow(at(RESURFACE_AFTER_MS))
    expect(await home()).toEqual([])
    expect(await inbox()).toEqual({ titles: [], unread: 0 })

    ctx.setNow(at(RESURFACE_AFTER_MS + 1))
    expect(await home()).toEqual(['overdrawn Test Everyday'])
    expect(await inbox()).toEqual({ titles: ['Overdrawn'], unread: 1 })
    expect(await call('count_notifications')).toEqual({ unread: 1 })
  })

  it('counts the later of two dismissals, as from a tab that had not caught up', async () => {
    await overdrawn()
    const id = await onlyItemId()
    await call('dismiss_notification', { id })
    ctx.setNow(at(12 * HOUR_MS))
    await call('dismiss_notification', { id })
    ctx.setNow(at(RESURFACE_AFTER_MS + 1))
    expect(await inbox()).toEqual({ titles: [], unread: 0 })
    expect(await home()).toEqual([])
    ctx.setNow(at(12 * HOUR_MS + RESURFACE_AFTER_MS + 1))
    expect(await inbox()).toEqual({ titles: ['Overdrawn'], unread: 1 })
  })

  it('starts the day over when dismissed again once it is back', async () => {
    await overdrawn()
    await call('dismiss_notification', { id: await onlyItemId() })
    ctx.setNow(at(RESURFACE_AFTER_MS + 1))
    await call('dismiss_notification', { id: await onlyItemId() })
    ctx.setNow(at(2 * RESURFACE_AFTER_MS))
    expect(await inbox()).toEqual({ titles: [], unread: 0 })
    ctx.setNow(at(2 * RESURFACE_AFTER_MS + 2))
    expect(await inbox()).toEqual({ titles: ['Overdrawn'], unread: 1 })
  })

  it('leaves a condition that cleared dismissed, however long ago', async () => {
    const accountId = await overdrawn()
    await call('dismiss_notification', { id: await onlyItemId() })
    await setBalance(accountId, 50_000)
    await notifyAt(MINUTE_MS)
    await notifyAt(RESURFACE_AFTER_MS + 2 * MINUTE_MS)
    expect(await stillDismissed()).toBe(true)
  })

  it('leaves one dismissed that clears in the very check that would bring it back', async () => {
    const accountId = await overdrawn()
    await call('dismiss_notification', { id: await onlyItemId() })
    await setBalance(accountId, 50_000)
    await notifyAt(RESURFACE_AFTER_MS + 1)
    expect(await stillDismissed()).toBe(true)
  })

  it('never pushes a condition that comes back, whether its push was sent or still owed', async () => {
    await saveSubscription(ctx.db, subscriptionFor(PHONE))
    await overdrawn('Everyday')
    expect(await runNotifier(ctx)).toBe('sent')
    // Joint is news the phone has not had yet when it is dismissed.
    ctx.setNow(at(MINUTE_MS))
    await overdrawn('Joint')
    const { items } = await call('list_notifications')
    for (const item of items) await call('dismiss_notification', { id: item.id })
    expect(push.sent).toHaveLength(1)

    ctx.setNow(at(MINUTE_MS + RESURFACE_AFTER_MS + 1))
    expect(await runNotifier(ctx)).toBe('nothing')
    expect(push.sent).toHaveLength(1)
    expect(await inbox()).toEqual({ titles: ['Overdrawn', 'Overdrawn'], unread: 2 })
  })

  it('keeps a fee dismissed for good, as it is news and not a condition', async () => {
    await feeCharged()
    await call('dismiss_notification', { id: await onlyItemId() })
    ctx.setNow(at(3 * DAY_MS))
    expect(await home()).toEqual([])
    expect(await inbox()).toEqual({ titles: [], unread: 0 })
  })

  it('keeps a budget dismissed for its period, as spending cannot be undone', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    const food = await call('create_category', { name: 'Groceries', budgetCents: 10_000 })
    const tx = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'KING SOOPERS',
      amountCents: 12_000,
    })
    await call('update_transaction', { id: tx, categoryId: food.id })
    await call('dismiss_notification', { id: await onlyItemId() })
    ctx.setNow(at(3 * DAY_MS))
    expect(await inbox()).toEqual({ titles: [], unread: 0 })
  })

  it('counts a condition that cleared and came back as new, as the inbox will', async () => {
    const accountId = await overdrawn()
    await call('dismiss_notification', { id: await onlyItemId() })
    await setBalance(accountId, 50_000)
    await refreshInbox(ctx)

    // Back within the hour: the same run of it, still dismissed (REARM_AFTER_MS).
    await setBalance(accountId, -100)
    ctx.setNow(at(REARM_AFTER_MS - 1))
    expect(await home()).toEqual([])
    // Back an hour on: new news. Home shows it before the inbox catches up, then both agree.
    ctx.setNow(at(REARM_AFTER_MS))
    expect(await home()).toEqual(['overdrawn Test Everyday'])
    expect(await inbox()).toEqual({ titles: ['Overdrawn'], unread: 1 })
  })

  it('brings back only conditions of kinds the owner has on, which are kept current', async () => {
    await overdrawn()
    await call('dismiss_notification', { id: await onlyItemId() })
    await updateNotificationSettings(ctx.db, { kinds: { overdrawn: false } })
    await notifyAt(RESURFACE_AFTER_MS + 1)
    // A fee is news, never a condition, so there is nothing of its kind to bring back.
    await resurfaceDismissed(ctx.db, ['overdraft_fee'], ctx.now())
    expect(await stillDismissed()).toBe(true)
    // Home goes by its own day all the same.
    expect(await home()).toEqual(['overdrawn Test Everyday'])
  })

  it('keeps an alert both hidden and dismissed off home until the later of the two runs out', async () => {
    const accountId = await overdrawn()
    await call('hide_home_alert', { kind: 'overdrawn', accountId })
    ctx.setNow(at(12 * HOUR_MS))
    await call('dismiss_notification', { id: await onlyItemId() })
    // The hide has run out, but the dismissal still has half a day.
    ctx.setNow(at(RESURFACE_AFTER_MS + HOUR_MS))
    expect(await home()).toEqual([])
    ctx.setNow(at(12 * HOUR_MS + RESURFACE_AFTER_MS + 1))
    expect(await home()).toEqual(['overdrawn Test Everyday'])
  })
})

describe('who can put alerts away', () => {
  const HOME_ACTIONS = ['list_home_alerts', 'hide_home_alert']

  it('is the owner in the app only, while assistants keep reading every alert', () => {
    for (const name of HOME_ACTIONS) expect(findAction(name)).toMatchObject({ surface: 'app' })
    expect(findAction('list_home_alerts')).toMatchObject({ scope: 'read' })
    expect(findAction('hide_home_alert')).toMatchObject({ scope: 'write' })
    for (const scope of ['read', 'write'] as const) {
      const names = agentTools(scope).map((tool) => tool.name)
      for (const name of HOME_ACTIONS) expect(names).not.toContain(name)
      expect(names).toContain('list_alerts')
    }
  })

  it('refuses an assistant that tries to hide an alert over MCP', async () => {
    const accountId = await overdrawn()
    const app = await buildApp(ctx, { webDir: null })
    try {
      const { token } = await createToken(ctx.db, 'Coach', 'write')
      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'hide_home_alert', arguments: { kind: 'overdrawn', accountId } },
        },
      })
      expect(response.json().result).toMatchObject({ isError: true })
      expect(await home()).toEqual(['overdrawn Test Everyday'])
    } finally {
      await app.close()
    }
  })
})
