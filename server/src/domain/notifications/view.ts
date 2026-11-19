// What the Notifications settings screen shows: the owner's choices and the
// state of push, including whether it is on for the device asking.

import type { AppContext } from '../../context.js'
import { loadVapidKeys } from '../../push/keys.js'
import { listSubscriptions } from '../../push/subscriptions.js'
import {
  getNotificationSettings,
  NOTIFICATION_KINDS,
  type NotificationKind,
  type NotificationSettings,
} from './settings.js'

/**
 * The kinds this server raises. The AI limit is stored and listed in the
 * schema already; it joins this list once the AI usage limits are in.
 */
export const AVAILABLE_KINDS: NotificationKind[] = NOTIFICATION_KINDS.filter(
  (kind) => kind !== 'ai_limit',
)

export interface NotificationSettingsView {
  settings: NotificationSettings
  available: NotificationKind[]
  push: {
    /** The server's public VAPID key: what a browser subscribes with. */
    publicKey: string
    /** How many devices have push on. */
    devices: number
    /** Whether the device asking is one of them. */
    thisDevice: boolean
  }
}

export async function notificationSettingsView(
  ctx: AppContext,
  endpoint?: string,
): Promise<NotificationSettingsView> {
  const [settings, keys, devices] = await Promise.all([
    getNotificationSettings(ctx.db),
    loadVapidKeys(ctx.db, ctx.config.encryptionKey),
    listSubscriptions(ctx.db),
  ])
  return {
    settings,
    available: AVAILABLE_KINDS,
    push: {
      publicKey: keys.publicKey,
      devices: devices.length,
      thisDevice: devices.some((device) => device.endpoint === endpoint),
    },
  }
}
