// The inbox: notifications kept once per kind and subject, with read,
// dismissed and resolved state, and pruned after a while.

import type { Db } from '../../db/pool.js'
import { notFound } from '../../errors.js'
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../lib/time.js'
import { STATE_KINDS, type NotificationKind } from './settings.js'
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
/** The bell brings the inbox up to date at most this often, however many tabs ask. */
export const BELL_REFRESH_MS = MINUTE_MS
/** The most the inbox shows. */
const LIST_LIMIT = 100

const COLUMNS = `id, kind, title, message, link, created_at AS "createdAt", read_at AS "readAt",
  resolved_at AS "resolvedAt"`

/**
 * Stores what the data calls for. New news is added, unread, with a push
 * owed. News already stored keeps its read and push state and takes the
 * latest wording. A condition that cleared over an hour ago and is back
 * counts as new.
 */
export async function recordCandidates(db: Db, candidates: Candidate[], now: Date): Promise<void> {
  // One row per key: a charge seen both pending and posted is one notification.
  const unique = [...new Map(candidates.map((one) => [`${one.kind}:${one.subject}`, one])).values()]
  if (unique.length === 0) return
  const column = (key: keyof Candidate) => unique.map((candidate) => candidate[key])
  // "fresh": a cleared condition that came back after the re-arm time.
  const fresh = `(notifications.resolved_at IS NOT NULL AND notifications.resolved_at <= $8)`
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
       push_state = CASE WHEN ${fresh} THEN 'pending' ELSE notifications.push_state END,
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
  // A kind never holds a colon, so kind:subject is a unique key.
  const keys = current.map((candidate) => `${candidate.kind}:${candidate.subject}`)
  await db.query(
    `UPDATE notifications SET resolved_at = $3
     WHERE kind = ANY($1) AND resolved_at IS NULL AND kind || ':' || subject <> ALL($2)`,
    [kinds, keys, now],
  )
}

/** Deletes old notifications. A condition still going on stays, so it is not news again. */
export async function pruneInbox(db: Db, now: Date): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM notifications
     WHERE created_at < $1 AND (resolved_at IS NOT NULL OR kind <> ALL($2))`,
    [new Date(now.getTime() - KEEP_DAYS * DAY_MS), STATE_KINDS],
  )
  return Number(rowCount)
}

/** The inbox, newest first, without dismissed notifications. */
export async function listNotifications(db: Db): Promise<Notification[]> {
  const { rows } = await db.query<Notification>(
    `SELECT ${COLUMNS} FROM notifications WHERE dismissed_at IS NULL
     ORDER BY created_at DESC, id LIMIT ${LIST_LIMIT}`,
  )
  return rows
}

/** Unread notifications about something still true: what the bell counts. */
export async function unreadCount(db: Db): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM notifications
     WHERE read_at IS NULL AND dismissed_at IS NULL AND resolved_at IS NULL`,
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

/** Takes a notification out of the inbox. It stays stored, so the same news does not return. */
export async function dismissNotification(db: Db, id: string, now: Date): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE notifications SET dismissed_at = coalesce(dismissed_at, $2),
       read_at = coalesce(read_at, $2)
     WHERE id = $1`,
    [id, now],
  )
  if (rowCount === 0) throw notFound('Notification')
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
