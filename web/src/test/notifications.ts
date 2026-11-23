// Fakes for notifications: the inbox and settings actions as the server
// answers them, and a browser's push plumbing (service worker, push manager,
// permission) that never reaches a real push service.

import { vi } from 'vitest'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  mergeNotificationSettings,
  NOTIFICATION_KINDS,
  notificationSettingsPatchSchema,
} from '../../../server/src/domain/notifications/settings'
import type { InboxItem } from '../pages/Inbox'
import type { NotificationsView } from '../pages/settings/notifications/notificationText'
import type { Handlers } from './fake'

/** A P-256 public key in the form the server hands out (65 bytes, base64url). */
export const PUBLIC_KEY = `B${'A'.repeat(86)}`

export const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-device'

/** An inbox item, unread and current unless a test says otherwise. */
export function inboxItem(fields: Partial<InboxItem> & Pick<InboxItem, 'id' | 'title'>): InboxItem {
  return {
    kind: 'overdrawn',
    message: 'Test Everyday is at -$40.',
    link: '/alerts',
    createdAt: new Date(Date.now() - 5 * 60_000),
    readAt: null,
    resolvedAt: null,
    ...fields,
  }
}

/** The inbox actions, keeping read and dismissed state like the server. */
export function inboxHandlers(initial: InboxItem[]): Handlers {
  let items = initial
  const unread = () => items.filter((item) => item.readAt === null).length
  const read = (ids: unknown) => {
    const chosen = Array.isArray(ids) ? ids : items.map((item) => item.id)
    items = items.map((item) =>
      chosen.includes(item.id) && item.readAt === null ? { ...item, readAt: new Date() } : item,
    )
  }
  return {
    count_notifications: () => ({ unread: unread() }),
    list_notifications: () => ({ items, unread: unread() }),
    mark_notifications_read: ({ ids }) => (read(ids), { unread: unread() }),
    dismiss_notification: ({ id }) => {
      items = items.filter((item) => item.id !== id)
      return { unread: unread() }
    },
  }
}

/** The settings actions, merging a change with the server's own schema. */
export function notificationSettingsHandlers(
  push: Partial<NotificationsView['push']> = {},
): Handlers {
  let settings = DEFAULT_NOTIFICATION_SETTINGS
  const endpoints = new Set<string>()
  if (push.thisDevice) endpoints.add(ENDPOINT)
  const others = push.devices ?? 0
  const view = (endpoint: unknown): NotificationsView => ({
    settings,
    available: NOTIFICATION_KINDS,
    push: {
      publicKey: PUBLIC_KEY,
      devices: others + endpoints.size,
      thisDevice: typeof endpoint === 'string' && endpoints.has(endpoint),
    },
  })
  return {
    get_notification_settings: ({ endpoint }) => view(endpoint),
    update_notification_settings: (patch) => {
      settings = mergeNotificationSettings(settings, notificationSettingsPatchSchema.parse(patch))
      return settings
    },
    subscribe_push: ({ endpoint }) => (endpoints.add(String(endpoint)), view(endpoint)),
    unsubscribe_push: ({ endpoint }) => (endpoints.delete(String(endpoint)), view(endpoint)),
    send_test_push: () => ({ devices: others + endpoints.size }),
  }
}

/** What the fake browser does: its permission answer and whether push is on already. */
export interface FakeBrowser {
  permission?: NotificationPermission
  answer?: NotificationPermission
  subscribed?: boolean
  registered?: boolean
}

/**
 * A browser with push: a service worker registration whose push manager
 * subscribes to ENDPOINT. Returns spies to check what was asked of it.
 */
export function fakePushBrowser(options: FakeBrowser = {}) {
  let subscribed = options.subscribed ?? false
  let registered = options.registered ?? true
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'device-key', auth: 'device-auth' } }),
    unsubscribe: vi.fn(async () => {
      subscribed = false
      return true
    }),
  }
  const pushManager = {
    getSubscription: vi.fn(async () => (subscribed ? subscription : null)),
    subscribe: vi.fn(async () => {
      subscribed = true
      return subscription
    }),
  }
  const registration = { pushManager }
  const serviceWorker = {
    getRegistration: vi.fn(async () => (registered ? registration : undefined)),
    register: vi.fn(async () => {
      registered = true
      return registration
    }),
    ready: Promise.resolve(registration),
  }
  const notification: { permission: NotificationPermission } = {
    permission: options.permission ?? 'default',
  }
  // As in a browser, the answer to the prompt is the permission from then on.
  const requestPermission = vi.fn(async () => {
    notification.permission = options.answer ?? 'granted'
    return notification.permission
  })
  vi.stubGlobal('Notification', Object.assign(notification, { requestPermission }))
  vi.stubGlobal('PushManager', function PushManager() {})
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true })
  return { pushManager, serviceWorker, subscription, requestPermission }
}

/** Takes the fake service worker back off navigator. */
export function forgetPushBrowser() {
  Reflect.deleteProperty(navigator, 'serviceWorker')
}
