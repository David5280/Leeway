// The inbox and push controls. All app only. Assistants already read the same
// facts through list_alerts, get_budget and list_bills, so reading the inbox
// would tell them nothing new, while marking it read or dismissing from an
// assistant could hide news from the owner. Push choices decide what reaches
// the owner's lock screen, so only the owner makes them.

import { z } from 'zod'
import { AppError, notFound } from '../errors.js'
import {
  claimBellRefresh,
  dismissNotification,
  listNotifications,
  markRead,
  unreadCount,
} from '../domain/notifications/inbox.js'
import { refreshInbox } from '../domain/notifications/notifier.js'
import {
  getNotificationSettings,
  kindsOn,
  notificationSettingsPatchSchema,
  updateNotificationSettings,
} from '../domain/notifications/settings.js'
import { notificationSettingsView } from '../domain/notifications/view.js'
import {
  endpointLookupSchema,
  findSubscription,
  listSubscriptions,
  removeSubscription,
  saveSubscription,
  subscriptionSchema,
} from '../push/subscriptions.js'
import type { AppContext } from '../context.js'
import { defineAction } from './action.js'

/** The bell's count, for the kinds the owner has on. */
async function unread(ctx: AppContext): Promise<{ unread: number }> {
  return { unread: await unreadCount(ctx.db, kindsOn(await getNotificationSettings(ctx.db))) }
}

export const countNotificationsAction = defineAction({
  name: 'count_notifications',
  title: 'Unread notifications',
  description: 'How many notifications are unread, for the bell.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => {
    if (await claimBellRefresh(ctx.db, ctx.now())) await refreshInbox(ctx)
    return unread(ctx)
  },
})

export const listNotificationsAction = defineAction({
  name: 'list_notifications',
  title: 'Inbox',
  description: 'The notifications in the inbox, newest first, and how many are unread.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => {
    const on = kindsOn(await refreshInbox(ctx))
    const [items, unread] = await Promise.all([
      listNotifications(ctx.db, on),
      unreadCount(ctx.db, on),
    ])
    return { items, unread }
  },
})

export const markNotificationsReadAction = defineAction({
  name: 'mark_notifications_read',
  title: 'Mark notifications read',
  description: 'Mark these notifications read, or all of them when no ids are given.',
  input: z.object({ ids: z.array(z.uuid()).max(100).optional() }).strict(),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { ids }) => {
    await markRead(ctx.db, ids, ctx.now())
    return unread(ctx)
  },
})

export const dismissNotificationAction = defineAction({
  name: 'dismiss_notification',
  title: 'Dismiss a notification',
  description: 'Take a notification out of the inbox.',
  input: z.object({ id: z.uuid() }).strict(),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { id }) => {
    await dismissNotification(ctx.db, id, ctx.now())
    return unread(ctx)
  },
})

/** This browser's push address, when it has one, to say whether push is on here. */
const deviceInput = z.object({ endpoint: endpointLookupSchema.optional() }).strict()

export const getNotificationSettingsAction = defineAction({
  name: 'get_notification_settings',
  title: 'Notification settings',
  description: 'Which notifications are on, their thresholds, quiet hours, and push devices.',
  input: deviceInput,
  scope: 'read',
  surface: 'app',
  run: (ctx, { endpoint }) => notificationSettingsView(ctx, endpoint),
})

export const updateNotificationSettingsAction = defineAction({
  name: 'update_notification_settings',
  title: 'Change notification settings',
  description: 'Turn kinds of notification on or off, set thresholds and quiet hours.',
  input: notificationSettingsPatchSchema,
  scope: 'write',
  surface: 'app',
  run: (ctx, patch) => updateNotificationSettings(ctx.db, patch),
})

export const subscribePushAction = defineAction({
  name: 'subscribe_push',
  title: 'Turn on push',
  description: 'Send notifications to this device, from the subscription its browser made.',
  input: subscriptionSchema,
  scope: 'write',
  surface: 'app',
  run: async (ctx, subscription) => {
    await saveSubscription(ctx.db, subscription)
    return notificationSettingsView(ctx, subscription.endpoint)
  },
})

export const unsubscribePushAction = defineAction({
  name: 'unsubscribe_push',
  title: 'Turn off push',
  description: 'Stop sending notifications to this device.',
  input: z.object({ endpoint: endpointLookupSchema }).strict(),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { endpoint }) => {
    await removeSubscription(ctx.db, endpoint)
    return notificationSettingsView(ctx, endpoint)
  },
})

export const sendTestPushAction = defineAction({
  name: 'send_test_push',
  title: 'Send a test notification',
  description: 'Send a test notification to this device.',
  input: z.object({ endpoint: endpointLookupSchema }).strict(),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { endpoint }) => {
    const device = await findSubscription(ctx.db, endpoint)
    if (!device) throw notFound('Push on this device')
    const outcome = await ctx.push.send(device, {
      title: 'Leeway',
      body: 'Notifications are on for this device.',
      url: '/inbox',
      tag: 'leeway-test',
    })
    if (outcome === 'sent') return { devices: (await listSubscriptions(ctx.db)).length }
    if (outcome === 'gone') await removeSubscription(ctx.db, endpoint)
    throw new AppError('push_error', TEST_FAILURES[outcome])
  },
})

const TEST_FAILURES = {
  gone: 'This device no longer accepts notifications from Leeway. Turn push on again.',
  retry: 'The push service is busy or out of reach. Try again in a minute.',
  rejected: 'The push service refused the test. Turn push off and on again.',
}
