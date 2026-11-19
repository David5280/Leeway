// The notifier: on a timer and after each sync, brings the inbox up to date
// with the data and sends any push owed. Every step can run again safely.

import type { AppContext } from '../../context.js'
import { deliverPushes, type DeliveryResult } from './delivery.js'
import { pruneInbox, recordCandidates, resolveCleared } from './inbox.js'
import {
  getNotificationSettings,
  NOTIFICATION_KINDS,
  type NotificationSettings,
} from './settings.js'
import { gatherCandidates } from './sources.js'

/** How often the notifier runs, besides right after a sync. */
export const NOTIFIER_MINUTES = 5

/**
 * Adds new notifications, clears conditions that ended, and prunes old ones.
 * Opening the inbox runs this too, so it is current without waiting for the timer.
 */
export async function refreshInbox(ctx: AppContext): Promise<NotificationSettings> {
  const choices = await getNotificationSettings(ctx.db)
  const now = ctx.now()
  const candidates = await gatherCandidates(ctx, choices)
  await recordCandidates(ctx.db, candidates, now)
  const checked = NOTIFICATION_KINDS.filter((kind) => choices.kinds[kind])
  await resolveCleared(ctx.db, checked, candidates, now)
  await pruneInbox(ctx.db, now)
  return choices
}

/** One run: the inbox brought up to date, then any push owed sent. */
export async function runNotifier(ctx: AppContext): Promise<DeliveryResult> {
  const choices = await refreshInbox(ctx)
  return deliverPushes(ctx, choices)
}
