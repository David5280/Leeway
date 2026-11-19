// The inbox and push actions: the owner's alone, in the app. The bell's count,
// reading and dismissing, the settings screen, and turning push on and off.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import { NOTIFICATION_KINDS } from '../src/domain/notifications/settings.js'
import { createToken } from '../src/domain/tokens.js'
import { buildApp } from '../src/http/app.js'
import { MINUTE_MS } from '../src/lib/time.js'
import { agentTools } from '../src/mcp/server.js'
import { actionCaller } from './actionCaller.js'
import { FakePushSender } from './fakePush.js'
import { deviceKeys, subscriptionFor } from './fixtures/push.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

const NOTIFICATION_ACTIONS = [
  'count_notifications',
  'list_notifications',
  'mark_notifications_read',
  'dismiss_notification',
  'get_notification_settings',
  'update_notification_settings',
  'subscribe_push',
  'unsubscribe_push',
  'send_test_push',
]
const NOW = new Date('2026-11-17T18:00:00Z')
const PHONE = 'https://web.push.apple.com/phone'

const push = new FakePushSender()
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call, callError } = actionCaller(() => ctx)

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
  push.answers.clear()
})

const overdrawn = (name: string) =>
  insertBankAccount(ctx.db, { name, subtype: 'checking', balanceCents: -100 })

describe('the inbox', () => {
  it('lists what the data calls for, newest first, with the unread count', async () => {
    await overdrawn('Everyday')
    // Opening the inbox brings it up to date at once.
    const { items, unread } = await call('list_notifications')
    expect(unread).toBe(1)
    expect(items.map((item) => item.message)).toEqual(['Test Everyday is overdrawn by $1.'])
    ctx.setNow(new Date(NOW.getTime() + MINUTE_MS))
    await overdrawn('Joint')
    const again = await call('list_notifications')
    expect(again.unread).toBe(2)
    expect(again.items.map((item) => item.message)).toEqual([
      'Test Joint is overdrawn by $1.',
      'Test Everyday is overdrawn by $1.',
    ])
    expect(again.items[0]).toEqual({
      id: expect.any(String),
      kind: 'overdrawn',
      title: 'Overdrawn',
      message: 'Test Joint is overdrawn by $1.',
      link: '/alerts',
      createdAt: ctx.now(),
      readAt: null,
      resolvedAt: null,
    })
    // The push wording stays on the server.
    expect(JSON.stringify(again)).not.toMatch(/below zero|push/i)
  })

  it('lets the bell bring the inbox up to date at most once a minute', async () => {
    expect(await call('count_notifications')).toEqual({ unread: 0 })
    await overdrawn('Everyday')
    expect(await call('count_notifications')).toEqual({ unread: 0 })
    ctx.setNow(new Date(NOW.getTime() + MINUTE_MS))
    expect(await call('count_notifications')).toEqual({ unread: 1 })
  })

  it('marks some or all read, and dismisses one', async () => {
    await overdrawn('Everyday')
    await overdrawn('Joint')
    const { items } = await call('list_notifications')
    expect(await call('mark_notifications_read', { ids: [items[0]!.id] })).toEqual({ unread: 1 })
    expect(await call('mark_notifications_read', {})).toEqual({ unread: 0 })
    const read = await call('list_notifications')
    expect(read.items.every((item) => item.readAt !== null)).toBe(true)

    expect(await call('dismiss_notification', { id: items[1]!.id })).toEqual({ unread: 0 })
    const left = await call('list_notifications')
    expect(left.items.map((item) => item.id)).toEqual([items[0]!.id])
  })

  it('counts a dismissed notification as read, and keeps it out of the inbox', async () => {
    await overdrawn('Everyday')
    const { items } = await call('list_notifications')
    expect(await call('dismiss_notification', { id: items[0]!.id })).toEqual({ unread: 0 })
    expect((await call('list_notifications')).items).toEqual([])
  })

  it('says plainly when a notification is not there', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(await callError('dismiss_notification', { id: missing })).toMatchObject({
      code: 'not_found',
      message: 'Notification not found',
    })
    expect((await callError('mark_notifications_read', { ids: ['x'] })).code).toBe('invalid_input')
  })
})

describe('settings', () => {
  it("shows the owner's choices, the kinds this server raises, and push state", async () => {
    const view = await call('get_notification_settings')
    expect(view.settings.kinds.overdrawn).toBe(true)
    // The AI limit is offered too, and starts off.
    expect(view.settings.kinds.ai_limit).toBe(false)
    expect(view.available).toEqual(NOTIFICATION_KINDS)
    expect(view.push).toEqual({
      publicKey: expect.stringMatching(/^B[\w-]{86}$/),
      devices: 0,
      thisDevice: false,
    })
    // The same server key every time: browsers subscribed with it.
    expect((await call('get_notification_settings')).push.publicKey).toBe(view.push.publicKey)
  })

  it('changes only what is given, within limits', async () => {
    const changed = await call('update_notification_settings', {
      kinds: { large_transaction: false },
      largeTransactionCents: 100_000,
      quietHours: { end: 8 },
    })
    expect(changed).toMatchObject({
      kinds: { large_transaction: false, overdrawn: true },
      largeTransactionCents: 100_000,
      quietHours: { on: true, start: 22, end: 8 },
    })
    for (const bad of [
      { billDueDays: 15 },
      { overBudgetPercent: 49 },
      { largeTransactionCents: 99 },
      { quietHours: { start: 24 } },
      { kinds: { made_up: true } },
      { pushEverything: true },
    ]) {
      expect((await callError('update_notification_settings', bad)).code).toBe('invalid_input')
    }
  })
})

describe('push on a device', () => {
  it('turns push on and off for the device asking', async () => {
    const on = await call('subscribe_push', { ...subscriptionFor(PHONE), label: 'iPhone' })
    expect(on.push).toMatchObject({ devices: 1, thisDevice: true })
    expect((await call('get_notification_settings', { endpoint: PHONE })).push.thisDevice).toBe(
      true,
    )
    expect(
      (
        await call('get_notification_settings', {
          endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        })
      ).push.thisDevice,
    ).toBe(false)
    const off = await call('unsubscribe_push', { endpoint: PHONE })
    expect(off.push).toMatchObject({ devices: 0, thisDevice: false })
  })

  it('refuses an address that is not a known push service', async () => {
    const error = await callError('subscribe_push', {
      endpoint: 'https://169.254.169.254/latest/meta-data',
      keys: deviceKeys(),
    })
    expect(error).toMatchObject({ code: 'invalid_input' })
    expect(error.message).toMatch(/push service Leeway does not know/)
  })

  it('lets a browser on a push service it would not take load its settings and turn off', async () => {
    const elsewhere = 'https://push.example.net/device-1'
    const view = await call('get_notification_settings', { endpoint: elsewhere })
    expect(view.push).toMatchObject({ devices: 0, thisDevice: false })
    expect((await call('unsubscribe_push', { endpoint: elsewhere })).push.devices).toBe(0)
    expect(await callError('send_test_push', { endpoint: elsewhere })).toMatchObject({
      code: 'not_found',
    })
    // Still a well-formed address, though.
    expect(
      await callError('get_notification_settings', { endpoint: 'not an address' }),
    ).toMatchObject({ code: 'invalid_input' })
  })

  it('sends a test to this device only', async () => {
    await call('subscribe_push', subscriptionFor(PHONE))
    await call('subscribe_push', subscriptionFor('https://fcm.googleapis.com/fcm/send/laptop'))
    expect(await call('send_test_push', { endpoint: PHONE })).toEqual({ devices: 2 })
    expect(push.sent).toEqual([
      {
        endpoint: PHONE,
        message: {
          title: 'Leeway',
          body: 'Notifications are on for this device.',
          url: '/inbox',
          tag: 'leeway-test',
        },
      },
    ])
  })

  it('says why a test did not arrive, and forgets a device that has gone', async () => {
    expect(await callError('send_test_push', { endpoint: PHONE })).toMatchObject({
      code: 'not_found',
      message: 'Push on this device not found',
    })
    await call('subscribe_push', subscriptionFor(PHONE))
    push.answers.set(PHONE, 'retry')
    expect((await callError('send_test_push', { endpoint: PHONE })).message).toMatch(/busy/)
    push.answers.set(PHONE, 'rejected')
    expect((await callError('send_test_push', { endpoint: PHONE })).message).toMatch(/refused/)
    push.answers.set(PHONE, 'gone')
    expect(await callError('send_test_push', { endpoint: PHONE })).toMatchObject({
      code: 'push_error',
      status: 502,
      message: 'This device no longer accepts notifications from Leeway. Turn push on again.',
    })
    expect((await call('get_notification_settings')).push.devices).toBe(0)
  })
})

describe('who controls it', () => {
  it('is the owner in the app only, never an assistant', () => {
    for (const name of NOTIFICATION_ACTIONS) {
      expect(findAction(name)).toMatchObject({ surface: 'app' })
    }
    const agentNames = agentTools('write').map((tool) => tool.name)
    for (const name of NOTIFICATION_ACTIONS) expect(agentNames).not.toContain(name)
  })

  it('refuses an assistant that tries to read the inbox or turn push on over MCP', async () => {
    const app = await buildApp(ctx, { webDir: null })
    try {
      const { token } = await createToken(ctx.db, 'Coach', 'write')
      for (const [name, args] of [
        ['list_notifications', {}],
        ['subscribe_push', subscriptionFor(PHONE)],
      ] as const) {
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
            params: { name, arguments: args },
          },
        })
        expect(response.json().result).toMatchObject({ isError: true })
      }
      expect((await call('get_notification_settings')).push.devices).toBe(0)
    } finally {
      await app.close()
    }
  })

  it('cannot be changed through update_settings', async () => {
    expect((await callError('update_settings', { notifications: {} })).code).toBe('invalid_input')
    expect(JSON.stringify(await call('get_settings'))).not.toMatch(/quietHours|largeTransaction/)
  })
})
