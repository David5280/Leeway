// The notifier: on a timer and soon after any sync, brings the inbox up to date
// with the data and sends any push owed. Every step can run again safely.

import type { AppContext } from '../../context.js'
import type { AccountAlert } from '../accountAlerts.js'
import { SECOND_MS } from '../../lib/time.js'
import { deliverPushes, type DeliveryResult } from './delivery.js'
import { currentAlerts, trackHomeHides } from './homeAlerts.js'
import { pruneInbox, recordCandidates, resolveCleared, resurfaceDismissed } from './inbox.js'
import { getNotificationSettings, kindsOn, type NotificationSettings } from './settings.js'
import { accountAlertCandidates, gatherCandidates } from './sources.js'

/** How often the notifier runs, besides right after a sync. */
export const NOTIFIER_MINUTES = 5
/**
 * How soon after a sync the notifier runs: long enough that several banks
 * syncing one after another make one check, and so one push.
 */
export const NOTIFY_AFTER_SYNC_MS = 5 * SECOND_MS

/**
 * Adds new notifications, clears conditions that ended, brings back ones
 * dismissed a day ago that still hold, and prunes old ones. Hides from the
 * home screen are kept current too, from every alert, whichever kinds are on.
 * Opening the inbox runs this too, so it is current without waiting for the timer.
 */
export async function refreshInbox(ctx: AppContext): Promise<NotificationSettings> {
  const choices = await getNotificationSettings(ctx.db)
  const now = ctx.now()
  const candidates = await gatherCandidates(ctx, choices)
  await recordCandidates(ctx.db, candidates, now)
  const on = kindsOn(choices)
  await resolveCleared(ctx.db, on, candidates, now)
  // After clearing, so only conditions still going on come back.
  await resurfaceDismissed(ctx.db, on, now)
  await trackHomeHides(ctx.db, await currentAlerts(ctx.db, now), now)
  await pruneInbox(ctx.db, now, on)
  return choices
}

/**
 * Records these account alerts, of the kinds turned on, and nothing else: all
 * a hide from home needs on record first. Leaving the other sources out means
 * trouble reading a budget or a bill cannot stop a hide.
 */
export async function recordAccountAlerts(
  ctx: AppContext,
  alerts: AccountAlert[],
  now: Date,
): Promise<void> {
  const choices = await getNotificationSettings(ctx.db)
  await recordCandidates(ctx.db, accountAlertCandidates(alerts, choices.kinds), now)
}

/** One run: the inbox brought up to date, then any push owed sent. */
export async function runNotifier(ctx: AppContext): Promise<DeliveryResult> {
  const choices = await refreshInbox(ctx)
  return deliverPushes(ctx, choices)
}
