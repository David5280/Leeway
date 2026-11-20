// The inbox: notifications kept once per kind and subject, with read,
// dismissed and resolved state, and pruned after a while.

import type { Db } from '../../db/pool.js'
import { notFound } from '../../errors.js'
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../lib/time.js'
import { RESURFACE_KINDS, STATE_KINDS, type NotificationKind } from './settings.js'
import type { Candidate } from './words.js'

/** A notification as the app shows it. The push body stays on the server. */
export interface Notification {
  id: string
  kind: NotificationKind
  title: string
  message: string
  link: string
  createdAt: Date
  readAt: Date | null
  /** When a condition (like being overdrawn) cleared; null while it lasts or for one-off news. */
  resolvedAt: Date | null
}

/** Notifications older than this are deleted, except conditions still going on. */
export const KEEP_DAYS = 90
/**
 * A condition that clears and comes back within this time picks up where it
 * was (read stays read, a push already sent is not sent again), so a balance
 * hovering around zero does not buzz the phone on every sync.
 */
export const REARM_AFTER_MS = HOUR_MS
/**
 * How long a dismissal, or a hide from the home screen, lasts while the
 * condition still holds. After this, an account still overdrawn (say) shows
 * again on the home screen and comes back to the inbox unread, until it is
 * dismissed again or clears.
 */
export const RESURFACE_AFTER_MS = DAY_MS
/** The bell brings the inbox up to date at most this often, however many tabs ask. */
export const BELL_REFRESH_MS = MINUTE_MS
/** The most the inbox shows. */
const LIST_LIMIT = 100

/** A notification's key. A kind never holds a colon, so kind:subject is unique. */
export const keyOf = ({ kind, subject }: { kind: string; subject: string }): string =>
  `${kind}:${subject}`

const COLUMNS = `id, kind, title, message, link, created_at AS "createdAt", read_at AS "readAt",
  resolved_at AS "resolvedAt"`

/**
 * Stores what the data calls for. New news is added, unread, with a push
 * owed. News already stored keeps its read and push state and takes the
 * latest wording. A condition that cleared over an hour ago and is back
 * counts as new. One back sooner whose push was let go while it was cleared,
 * before it was ever sent, is owed its push again.
 */
export async function recordCandidates(db: Db, candidates: Candidate[], now: Date): Promise<void> {
  // One row per key: a charge seen both pending and posted is one notification.
  const unique = [...new Map(candidates.map((one) => [keyOf(one), one])).values()]
  if (unique.length === 0) return
  const column = (key: keyof Candidate) => unique.map((candidate) => candidate[key])
  // "fresh": a cleared condition that came back after the re-arm time.
  const fresh = `(notifications.resolved_at IS NOT NULL AND notifications.resolved_at <= $8)`
  // "unsent": a cleared condition whose push was let go unsent; delivery skips it again if read.
  const unsent = `(notifications.resolved_at IS NOT NULL AND notifications.push_state = 'skipped'
    AND notifications.pushed_at IS NULL)`
  await db.query(
    `INSERT INTO notifications (kind, subject, title, message, push_body, link, created_at, push_state)
     SELECT k, s, t, m, p, l, $7, 'pending'
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
       AS c (k, s, t, m, p, l)
     ON CONFLICT (kind, subject) DO UPDATE SET
       title = excluded.title, message = excluded.message,
       push_body = excluded.push_body, link = excluded.link,
       created_at = CASE WHEN ${fresh} THEN excluded.created_at ELSE notifications.created_at END,
       read_at = CASE WHEN ${fresh} THEN NULL ELSE notifications.read_at END,
       dismissed_at = CASE WHEN ${fresh} THEN NULL ELSE notifications.dismissed_at END,
       push_state = CASE WHEN ${fresh} OR ${unsent} THEN 'pending'
         ELSE notifications.push_state END,
       pushed_at = CASE WHEN ${fresh} THEN NULL ELSE notifications.pushed_at END,
       resolved_at = NULL
     WHERE notifications.resolved_at IS NOT NULL
       OR (notifications.title, notifications.message, notifications.push_body, notifications.link)
         IS DISTINCT FROM (excluded.title, excluded.message, excluded.push_body, excluded.link)`,
    [
      column('kind'),
      column('subject'),
      column('title'),
      column('message'),
      column('pushBody'),
      column('link'),
      now,
      new Date(now.getTime() - REARM_AFTER_MS),
    ],
  )
}

/**
 * Moves notifications of one kind to new subjects, when what they are about
 * is known by a new id (a charge the bank sends again under a new id). One
 * already kept under the new subject gives way to the one moved, so the
 * notification is kept once, with its read and push state, and not pushed
 * again.
 */
export async function moveSubjects(
  db: Db,
  kind: NotificationKind,
  moves: { from: string; to: string }[],
): Promise<void> {
  const changed = [
    ...new Map(moves.filter(({ from, to }) => from !== to).map((m) => [m.to, m])).values(),
  ]
  if (changed.length === 0) return
  const from = changed.map((move) => move.from)
  const to = changed.map((move) => move.to)
  await db.query(
    `DELETE FROM notifications n USING unnest($2::text[], $3::text[]) AS m(old, new)
     WHERE n.kind = $1 AND n.subject = m.new
       AND EXISTS (SELECT 1 FROM notifications o WHERE o.kind = $1 AND o.subject = m.old)`,
    [kind, from, to],
  )
  await db.query(
    `UPDATE notifications n SET subject = m.new
     FROM unnest($2::text[], $3::text[]) AS m(old, new)
     WHERE n.kind = $1 AND n.subject = m.old`,
    [kind, from, to],
  )
}

/**
 * Marks conditions of these kinds that the data no longer calls for as
 * cleared. Only kinds that were checked are touched: a kind turned off keeps
 * its notifications as they were.
 */
export async function resolveCleared(
  db: Db,
  checked: NotificationKind[],
  current: Candidate[],
  now: Date,
): Promise<void> {
  const kinds = checked.filter((kind) => STATE_KINDS.includes(kind))
  if (kinds.length === 0) return
  const keys = current.map(keyOf)
  await db.query(
    `UPDATE notifications SET resolved_at = $3
     WHERE kind = ANY($1) AND resolved_at IS NULL AND kind || ':' || subject <> ALL($2)`,
    [kinds, keys, now],
  )
}

/**
 * Deletes old notifications. A condition still going on stays, so it is not
 * news again, unless its kind is turned off: nothing then checks it.
 */
export async function pruneInbox(db: Db, now: Date, on: NotificationKind[]): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM notifications
     WHERE created_at < $1 AND (resolved_at IS NOT NULL OR kind <> ALL($2) OR kind <> ALL($3))`,
    [new Date(now.getTime() - KEEP_DAYS * DAY_MS), STATE_KINDS, on],
  )
  return Number(rowCount)
}

/**
 * The inbox, newest first, of the kinds turned on, without dismissed ones. A
 * kind turned off is hidden, not cleared: turned on again, what is still true
 * shows as it was.
 */
export async function listNotifications(db: Db, on: NotificationKind[]): Promise<Notification[]> {
  const { rows } = await db.query<Notification>(
    `SELECT ${COLUMNS} FROM notifications WHERE dismissed_at IS NULL AND kind = ANY($1)
     ORDER BY created_at DESC, id LIMIT ${LIST_LIMIT}`,
    [on],
  )
  return rows
}

/**
 * What the bell counts: the inbox's unread notifications, cleared or not, as
 * the inbox shows them unread until opened or marked read.
 */
export async function unreadCount(db: Db, on: NotificationKind[]): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM notifications
     WHERE read_at IS NULL AND dismissed_at IS NULL AND kind = ANY($1)`,
    [on],
  )
  return rows[0]!.count
}

/** Marks these notifications read, or every one when no ids are given. */
export async function markRead(db: Db, ids: string[] | undefined, now: Date): Promise<void> {
  await db.query(
    `UPDATE notifications SET read_at = $2
     WHERE read_at IS NULL AND ($1::uuid[] IS NULL OR id = ANY($1))`,
    [ids ?? null, now],
  )
}

/**
 * Takes a notification out of the inbox. It stays stored, so the same news
 * does not return; a condition still going on a day later does (see
 * resurfaceDismissed). Dismissing again starts that day over.
 */
export async function dismissNotification(db: Db, id: string, now: Date): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE notifications SET dismissed_at = $2, read_at = coalesce(read_at, $2)
     WHERE id = $1`,
    [id, now],
  )
  if (rowCount === 0) throw notFound('Notification')
}

/**
 * Brings back conditions of these kinds dismissed over a day ago that still
 * hold, unread, so a problem left alone is not forgotten. Only conditions the
 * owner can fix come back (RESURFACE_KINDS); one-off news, like a fee, and a
 * budget stay dismissed. The push state is left as it was: the phone had
 * this news already, and a push still owed when it was dismissed was let go
 * then (delivery.ts skips read and dismissed news, and news over a day old).
 */
export async function resurfaceDismissed(
  db: Db,
  checked: NotificationKind[],
  now: Date,
): Promise<void> {
  const kinds = checked.filter((kind) => RESURFACE_KINDS.includes(kind))
  if (kinds.length === 0) return
  await db.query(
    `UPDATE notifications SET dismissed_at = NULL, read_at = NULL
     WHERE dismissed_at < $2 AND resolved_at IS NULL AND kind = ANY($1)`,
    [kinds, new Date(now.getTime() - RESURFACE_AFTER_MS)],
  )
}

/**
 * Whether the bell should bring the inbox up to date now: true at most once a
 * minute. Checked and written in one statement, so two tabs refresh once.
 */
export async function claimBellRefresh(db: Db, now: Date): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE notification_settings SET refreshed_at = $1
     WHERE refreshed_at IS NULL OR refreshed_at <= $2`,
    [now, new Date(now.getTime() - BELL_REFRESH_MS)],
  )
  return rowCount === 1
}
