// Pushes: one for a burst of news, held through quiet hours, spaced out,
// sent to every device, with expired devices removed. Every push goes to a
// fake push sender, and what it would show is checked for private details.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  composePush,
  deliverPushes,
  MIN_PUSH_GAP_MS,
  STALE_AFTER_MS,
  type PendingPush,
} from '../src/domain/notifications/delivery.js'
import { runNotifier } from '../src/domain/notifications/notifier.js'
import {
  getNotificationSettings,
  updateNotificationSettings,
} from '../src/domain/notifications/settings.js'
import { getSettings, mergeSettings, saveSettings } from '../src/domain/settings.js'
import { MINUTE_MS } from '../src/lib/time.js'
import { listSubscriptions, saveSubscription } from '../src/push/subscriptions.js'
import { FakePushSender } from './fakePush.js'
import { subscriptionFor } from './fixtures/push.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'
import { withoutUuids } from './uuids.js'

/** 11 AM in Denver, well outside quiet hours. */
const MORNING = new Date('2026-11-17T18:00:00Z')
const PHONE = 'https://web.push.apple.com/phone'
const LAPTOP = 'https://fcm.googleapis.com/fcm/send/laptop'

const push = new FakePushSender()
let ctx: Awaited<ReturnType<typeof createTestContext>>
const later = (ms: number) => new Date(ctx.now().getTime() + ms)

beforeAll(async () => {
  ctx = await createTestContext({ now: MORNING, push })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(MORNING)
  push.sent.length = 0
  push.answers.clear()
  await saveSettings(
    ctx.db,
    mergeSettings(await getSettings(ctx.db), { timeZone: 'America/Denver' }),
  )
  await saveSubscription(ctx.db, subscriptionFor(PHONE))
})

const overdrawn = (name = 'Everyday') =>
  insertBankAccount(ctx.db, { name, subtype: 'checking', balanceCents: -4210, mask: '6789' })
const pushStates = async () =>
  (await ctx.db.query('SELECT push_state FROM notifications ORDER BY created_at')).rows.map(
    (row) => row.push_state,
  )

describe('composePush', () => {
  const item = (title: string, n = 1): PendingPush => ({
    id: `id-${title}-${n}`,
    kind: 'overdrawn',
    title,
    pushBody: `${title} body`,
    link: '/alerts',
  })

  it('sends one notification as itself', () => {
    expect(composePush([item('Overdrawn')])).toEqual({
      title: 'Overdrawn',
      body: 'Overdrawn body',
      url: '/alerts',
      tag: 'leeway-overdrawn',
    })
  })

  it('rolls several into a count and their kinds, opening the inbox', () => {
    expect(composePush([item('Overdrawn'), item('Overdrawn', 2)])).toEqual({
      title: '2 new alerts',
      body: 'Overdrawn.',
      url: '/inbox',
      tag: 'leeway-inbox',
    })
    expect(composePush([item('Overdrawn'), item('Large charge')]).body).toBe(
      'Overdrawn and Large charge.',
    )
    expect(composePush([item('A'), item('B'), item('C')]).body).toBe('A, B and C.')
    expect(composePush([item('A'), item('B'), item('C'), item('D')])).toMatchObject({
      title: '4 new alerts',
      body: 'A, B, C and more.',
    })
  })
})

describe('delivering', () => {
  it('pushes new news to every device, once', async () => {
    await saveSubscription(ctx.db, subscriptionFor(LAPTOP))
    await overdrawn()
    expect(await runNotifier(ctx)).toBe('sent')
    expect(push.sent).toEqual([
      {
        endpoint: PHONE,
        message: {
          title: 'Overdrawn',
          body: 'Test Everyday is below zero.',
          url: '/alerts',
          tag: 'leeway-overdrawn',
        },
      },
      expect.objectContaining({ endpoint: LAPTOP }),
    ])
    expect(await pushStates()).toEqual(['sent'])
    const devices = await listSubscriptions(ctx.db)
    expect(devices.every((device) => device.lastSuccessAt?.getTime() === MORNING.getTime())).toBe(
      true,
    )
    // Nothing more to say on the next run.
    ctx.setNow(later(MIN_PUSH_GAP_MS))
    expect(await runNotifier(ctx)).toBe('nothing')
    expect(push.sent).toHaveLength(2)
  })

  it('sends one push for a burst of syncs, then spaces pushes out', async () => {
    await overdrawn('Everyday')
    expect(await runNotifier(ctx)).toBe('sent')
    // Two more accounts go wrong minutes later: they wait for the gap...
    ctx.setNow(later(5 * MINUTE_MS))
    await overdrawn('Savings')
    expect(await runNotifier(ctx)).toBe('waiting')
    ctx.setNow(later(5 * MINUTE_MS))
    await overdrawn('Joint')
    expect(await runNotifier(ctx)).toBe('waiting')
    expect(push.sent).toHaveLength(1)
    // ...then go out together, as one.
    ctx.setNow(new Date(MORNING.getTime() + MIN_PUSH_GAP_MS))
    expect(await runNotifier(ctx)).toBe('sent')
    expect(push.sent).toHaveLength(2)
    expect(push.sent[1]!.message).toEqual({
      title: '2 new alerts',
      body: 'Overdrawn.',
      url: '/inbox',
      tag: 'leeway-inbox',
    })
  })

  it('holds pushes through quiet hours and sends them when they end, while the inbox fills at once', async () => {
    // 11 PM in Denver.
    ctx.setNow(new Date('2026-11-18T06:00:00Z'))
    await overdrawn()
    expect(await runNotifier(ctx)).toBe('quiet')
    expect(push.sent).toEqual([])
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM notifications')
    expect(rows[0].n).toBe(1)
    // 6:55 AM: still quiet.
    ctx.setNow(new Date('2026-11-18T13:55:00Z'))
    expect(await runNotifier(ctx)).toBe('quiet')
    // 7 AM: out it goes.
    ctx.setNow(new Date('2026-11-18T14:00:00Z'))
    expect(await runNotifier(ctx)).toBe('sent')
    expect(push.sent).toHaveLength(1)
  })

  it('sends at once with quiet hours off', async () => {
    await updateNotificationSettings(ctx.db, { quietHours: { on: false } })
    ctx.setNow(new Date('2026-11-18T06:00:00Z'))
    await overdrawn()
    expect(await runNotifier(ctx)).toBe('sent')
  })

  it('owes nothing when no device has push on', async () => {
    await ctx.db.query('DELETE FROM push_subscriptions')
    await overdrawn()
    expect(await runNotifier(ctx)).toBe('no_devices')
    expect(await pushStates()).toEqual(['skipped'])
    // A device turned on later is not flooded with old news.
    await saveSubscription(ctx.db, subscriptionFor(PHONE))
    expect(await runNotifier(ctx)).toBe('nothing')
  })

  it.each([
    ['read in the app', () => ctx.db.query('UPDATE notifications SET read_at = now()')],
    ['dismissed', () => ctx.db.query('UPDATE notifications SET dismissed_at = now()')],
    ['cleared', () => ctx.db.query('UPDATE notifications SET resolved_at = now()')],
    ['turned off', () => updateNotificationSettings(ctx.db, { kinds: { overdrawn: false } })],
    ['a day old', async () => ctx.setNow(later(STALE_AFTER_MS))],
  ])('drops a push owed for news since %s', async (_, change) => {
    // 11 PM in Denver: the news is recorded and its push held.
    ctx.setNow(new Date('2026-11-18T06:00:00Z'))
    await overdrawn()
    expect(await runNotifier(ctx)).toBe('quiet')
    // 7 AM, when it would have gone out.
    ctx.setNow(new Date('2026-11-18T14:00:00Z'))
    await change()
    expect(await deliverPushes(ctx, await getNotificationSettings(ctx.db))).toBe('nothing')
    expect(await pushStates()).toEqual(['skipped'])
    expect(push.sent).toEqual([])
  })

  it('removes a device the push service says has gone, on a 404 or a 410', async () => {
    await saveSubscription(ctx.db, subscriptionFor(LAPTOP))
    push.answers.set(PHONE, 'gone')
    await overdrawn()
    expect(await runNotifier(ctx)).toBe('sent')
    expect((await listSubscriptions(ctx.db)).map((device) => device.endpoint)).toEqual([LAPTOP])
  })

  it('drops the push when every device has gone or refuses it', async () => {
    await saveSubscription(ctx.db, subscriptionFor(LAPTOP))
    push.answers.set(PHONE, 'gone')
    push.answers.set(LAPTOP, 'rejected')
    await overdrawn()
    expect(await runNotifier(ctx)).toBe('dropped')
    expect(await pushStates()).toEqual(['skipped'])
    expect(await listSubscriptions(ctx.db)).toHaveLength(1)
  })

  it('keeps the push owed when the push service is busy, and tries again after the gap', async () => {
    push.answers.set(PHONE, 'retry')
    await overdrawn()
    expect(await runNotifier(ctx)).toBe('retry')
    expect(await pushStates()).toEqual(['pending'])
    ctx.setNow(later(MINUTE_MS))
    expect(await runNotifier(ctx)).toBe('waiting')
    push.answers.clear()
    ctx.setNow(later(MIN_PUSH_GAP_MS))
    expect(await runNotifier(ctx)).toBe('sent')
  })

  it('sends one push when two servers deliver at once', async () => {
    await overdrawn()
    await runNotifierHold()
    const choices = await getNotificationSettings(ctx.db)
    const results = await Promise.all([deliverPushes(ctx, choices), deliverPushes(ctx, choices)])
    // The other finds the slot taken, or, if it looks a moment later, the push already sent.
    expect(results.filter((result) => result === 'sent')).toHaveLength(1)
    expect(results.filter((result) => result !== 'sent')[0]).toMatch(/^(waiting|nothing)$/)
    expect(push.sent).toHaveLength(1)
  })

  /** Records the news without delivering it. */
  async function runNotifierHold() {
    await updateNotificationSettings(ctx.db, { quietHours: { on: true, start: 0, end: 23 } })
    ctx.setNow(new Date('2026-11-17T12:00:00Z'))
    expect(await runNotifier(ctx)).toBe('quiet')
    await updateNotificationSettings(ctx.db, { quietHours: { on: false } })
  }
})

describe('what a push may say', () => {
  it("never carries an amount, an account number or the bank's own text", async () => {
    await updateNotificationSettings(ctx.db, { quietHours: { on: false } })
    // Every kind at once, with private details everywhere the data allows.
    const { accountId, connectionId } = await insertBankAccount(ctx.db, {
      name: 'Everyday',
      subtype: 'checking',
      balanceCents: -4210,
      mask: '6789',
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-17',
      name: 'POS DEBIT 4417 CARD 6789 PHARMACY RX',
      merchantName: 'Discreet Clinic',
      amountCents: 77_777,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-16',
      name: 'OVERDRAFT FEE 6789',
      amountCents: 3_456,
    })
    await ctx.db.query(`UPDATE connections SET status = 'needs_reauth' WHERE id = $1`, [
      connectionId,
    ])
    await runNotifier(ctx)
    const { rows } = await ctx.db.query('SELECT push_body, message FROM notifications')
    expect(rows.length).toBeGreaterThanOrEqual(4)
    // Each push body holds no digits at all; a push's only number is a count of alerts.
    for (const { push_body } of rows) expect(push_body).not.toMatch(/\d/)
    expect(push.sent).toHaveLength(1)
    const { message } = push.sent[0]!
    expect(message.title).toBe(`${rows.length} new alerts`)
    expect(withoutUuids(`${message.body} ${message.url} ${message.tag}`)).not.toMatch(/\d/)
    expect(JSON.stringify(push.sent)).not.toMatch(
      /6789|42\.10|777|3456|34\.56|PHARMACY|Discreet|Clinic|POS DEBIT/i,
    )
    // The inbox keeps the detail.
    expect(rows.map((row) => row.message).join(' ')).toMatch(/Discreet Clinic charged \$777\.77/)
  })
})
