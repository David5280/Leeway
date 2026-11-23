// The notifier: on a timer and soon after any sync, brings the inbox up to date
// with the data and sends any push owed. Every step can run again safely.

import type { AppContext } from '../../context.js'
import { todayIn } from '../../lib/dates.js'
import { SECOND_MS } from '../../lib/time.js'
import { settleBillChanges } from '../billChangeSource.js'
import { leakReader } from '../leaks/leakSource.js'
import { getSettings } from '../settings.js'
import { deliverPushes, type DeliveryResult } from './delivery.js'
import { currentAlerts, trackHomeHides } from './homeAlerts.js'
import { pruneInbox, recordCandidates, resolveCleared, resurfaceDismissed } from './inbox.js'
import { getNotificationSettings, kindsOn, type NotificationSettings } from './settings.js'
import { gatherCandidates } from './sources.js'

/** How often the notifier runs, besides right after a sync. */
export const NOTIFIER_MINUTES = 5
/**
 * How soon after a sync the notifier runs: long enough that several banks
 * syncing one after another make one check, and so one push.
 */
export const NOTIFY_AFTER_SYNC_MS = 5 * SECOND_MS

/**
 * Takes the new amount as usual for bills charged it twice in a row, adds new
 * notifications, clears conditions that ended, brings back ones
 * dismissed a day ago that still hold, and prunes old ones. Hides from the
 * home screen are kept current too, from every alert, whichever kinds are on.
 * Opening the inbox runs this too, so it is current without waiting for the timer.
 */
export async function refreshInbox(ctx: AppContext): Promise<NotificationSettings> {
  const choices = await getNotificationSettings(ctx.db)
  const now = ctx.now()
  // A bill charged its new amount twice in a row takes it as usual first, so its alert clears.
  const { timeZone } = await getSettings(ctx.db)
  const today = todayIn(timeZone, now)
  await settleBillChanges(ctx.db, timeZone, today)
  // The candidates and the home hides below both list alerts: they share one read of the leaks.
  const leaks = leakReader(ctx.db, today)
  const candidates = await gatherCandidates(ctx, choices, leaks)
  await recordCandidates(ctx.db, candidates, now)
  const on = kindsOn(choices)
  await resolveCleared(ctx.db, on, candidates, now)
  // After clearing, so only conditions still going on come back.
  await resurfaceDismissed(ctx.db, on, now)
  await trackHomeHides(ctx.db, await currentAlerts(ctx.db, now, { leaks }), now)
  await pruneInbox(ctx.db, now, on)
  return choices
}

/** One run: the inbox brought up to date, then any push owed sent. */
export async function runNotifier(ctx: AppContext): Promise<DeliveryResult> {
  const choices = await refreshInbox(ctx)
  return deliverPushes(ctx, choices)
}
