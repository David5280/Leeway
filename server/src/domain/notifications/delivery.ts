// Pushing new notifications to the owner's devices: one push for a burst of
// news, never during quiet hours, and never more than one every few minutes.

import type { AppContext } from '../../context.js'
import type { Db } from '../../db/pool.js'
import { HOUR_MS, MINUTE_MS } from '../../lib/time.js'
import type { PushMessage, PushOutcome } from '../../push/sender.js'
import {
  listSubscriptions,
  recordDelivered,
  removeSubscriptionById,
  type Subscription,
} from '../../push/subscriptions.js'
import { getSettings } from '../settings.js'
import { isQuiet } from './quietHours.js'
import { NOTIFICATION_KINDS, type NotificationKind, type NotificationSettings } from './settings.js'

/** The least time between two pushes; news in between is rolled into the next one. */
export const MIN_PUSH_GAP_MS = 15 * MINUTE_MS
/** A push still owed after this long (the server was down, say) is dropped; the inbox has it. */
export const STALE_AFTER_MS = 24 * HOUR_MS
/** A rolled-up push names at most this many kinds of news. */
const NAMED_IN_SUMMARY = 3

/** A notification with a push owed. */
export interface PendingPush {
  id: string
  kind: NotificationKind
  title: string
  pushBody: string
  link: string
}

/**
 * nothing: no push owed. quiet: owed, waiting for quiet hours to end.
 * waiting: owed, waiting for the gap since the last push. no_devices: no
 * device has push on, so nothing is owed any more. sent: delivered to at
 * least one device. retry: no device took it yet; tried again later.
 * dropped: every device refused it or has gone.
 */
export type DeliveryResult =
  'nothing' | 'quiet' | 'waiting' | 'no_devices' | 'sent' | 'retry' | 'dropped'

/** "Overdrawn", "Overdrawn and Low balance", or the first few "and more". */
function listOf(titles: string[]): string {
  if (titles.length > NAMED_IN_SUMMARY) {
    return `${titles.slice(0, NAMED_IN_SUMMARY).join(', ')} and more`
  }
  if (titles.length === 1) return titles[0]!
  return `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)!}`
}

/**
 * The one push for everything owed: a single notification as itself, or
 * several as a count and their kinds, opening the inbox.
 */
export function composePush(pending: PendingPush[]): PushMessage {
  if (pending.length === 1) {
    const [only] = pending as [PendingPush]
    return { title: only.title, body: only.pushBody, url: only.link, tag: `leeway-${only.kind}` }
  }
  const titles = [...new Set(pending.map((item) => item.title))]
  return {
    title: `${pending.length} new alerts`,
    body: `${listOf(titles)}.`,
    url: '/inbox',
    tag: 'leeway-inbox',
  }
}

/**
 * Drops pushes no longer worth sending: read or dismissed in the app already,
 * cleared, too old, or of a kind turned off since.
 */
async function skipStale(db: Db, kindsOn: NotificationKind[], now: Date): Promise<void> {
  await db.query(
    `UPDATE notifications SET push_state = 'skipped'
     WHERE push_state = 'pending' AND (read_at IS NOT NULL OR dismissed_at IS NOT NULL
       OR resolved_at IS NOT NULL OR created_at < $1 OR kind <> ALL($2))`,
    [new Date(now.getTime() - STALE_AFTER_MS), kindsOn],
  )
}

async function pendingPushes(db: Db): Promise<PendingPush[]> {
  const { rows } = await db.query<PendingPush>(
    `SELECT id, kind, title, push_body AS "pushBody", link FROM notifications
     WHERE push_state = 'pending' ORDER BY created_at, id`,
  )
  return rows
}

async function settlePushes(db: Db, ids: string[], state: 'sent' | 'skipped', now: Date) {
  await db.query(
    `UPDATE notifications SET push_state = $2, pushed_at = CASE WHEN $2 = 'sent' THEN $3::timestamptz END
     WHERE id = ANY($1)`,
    [ids, state, now],
  )
}

/**
 * Takes the next push slot, only if the last push was long enough ago.
 * Checked and written in one statement, so two servers send one push.
 */
async function claimPushSlot(db: Db, now: Date): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE notification_settings SET last_push_at = $1
     WHERE last_push_at IS NULL OR last_push_at <= $2`,
    [now, new Date(now.getTime() - MIN_PUSH_GAP_MS)],
  )
  return rowCount === 1
}

/** Sends to every device, removing the ones the push service says are gone. */
async function sendToAll(
  ctx: AppContext,
  devices: Subscription[],
  message: PushMessage,
): Promise<PushOutcome[]> {
  return Promise.all(
    devices.map(async (device) => {
      const outcome = await ctx.push.send(device, message)
      if (outcome === 'gone') await removeSubscriptionById(ctx.db, device.id)
      if (outcome === 'sent') await recordDelivered(ctx.db, device.id, ctx.now())
      return outcome
    }),
  )
}

/** Sends the push owed, if any, and if now is a good time. */
export async function deliverPushes(
  ctx: AppContext,
  choices: NotificationSettings,
): Promise<DeliveryResult> {
  const { db } = ctx
  const now = ctx.now()
  const kindsOn = NOTIFICATION_KINDS.filter((kind) => choices.kinds[kind])
  await skipStale(db, kindsOn, now)
  const pending = await pendingPushes(db)
  if (pending.length === 0) return 'nothing'
  const { timeZone } = await getSettings(db)
  if (isQuiet(now, timeZone, choices.quietHours)) return 'quiet'
  const ids = pending.map((item) => item.id)
  const devices = await listSubscriptions(db)
  if (devices.length === 0) {
    await settlePushes(db, ids, 'skipped', now)
    return 'no_devices'
  }
  if (!(await claimPushSlot(db, now))) return 'waiting'

  const outcomes = await sendToAll(ctx, devices, composePush(pending))
  if (outcomes.includes('sent')) {
    await settlePushes(db, ids, 'sent', now)
    return 'sent'
  }
  // Left owed: the slot just taken spaces out the next try.
  if (outcomes.includes('retry')) return 'retry'
  await settlePushes(db, ids, 'skipped', now)
  return 'dropped'
}
