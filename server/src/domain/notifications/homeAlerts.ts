// The account alerts the home screen shows: every current alert, less the
// ones the owner put away. An alert goes from home when it is hidden there,
// which leaves the inbox alone, or dismissed in the inbox. Either lasts a day
// while the alert still holds (RESURFACE_AFTER_MS), except that a fee
// dismissed in the inbox is gone for good: it is one-off news, not a
// condition. An alert that clears takes its hide with it, so one that comes
// back later shows afresh.
//
// The rules are applied here, as the home screen asks, rather than waiting
// for the notifier, so home and the inbox agree from the moment of a click.

import type { Db } from '../../db/pool.js'
import { notFound } from '../../errors.js'
import type { AccountAlert, AlertKind } from '../accountAlerts.js'
import { keyOf, REARM_AFTER_MS, RESURFACE_AFTER_MS } from './inbox.js'
import { STATE_KINDS } from './settings.js'
import { accountAlertSubject } from './words.js'

/** An alert's key, as its notification and its home hide are both stored. */
const alertKey = (alert: AccountAlert): string =>
  keyOf({ kind: alert.kind, subject: accountAlertSubject(alert) })

/**
 * Drops hides that no longer count: over a day old, or for an alert that is
 * no longer current (it cleared, or a newer fee replaced it). `current` holds
 * the keys of every alert there is now.
 */
async function pruneHides(db: Db, current: string[], cutoff: Date): Promise<void> {
  await db.query(
    `DELETE FROM alert_hides WHERE hidden_at < $1 OR kind || ':' || subject <> ALL($2)`,
    [cutoff, current],
  )
}

/**
 * The keys, among `current`, of alerts put away from home: hidden there in
 * the last day, or dismissed in the inbox and still within its rule. A
 * dismissed condition counts for a day, and only while its notification still
 * stands for this run of it: one that cleared over REARM_AFTER_MS ago and is
 * back is new, as the inbox itself will treat it (recordCandidates).
 */
async function putAwayKeys(
  db: Db,
  current: string[],
  cutoff: Date,
  rearmed: Date,
): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(
    `SELECT kind || ':' || subject AS key FROM alert_hides
     WHERE hidden_at >= $2 AND kind || ':' || subject = ANY($1)
     UNION
     SELECT kind || ':' || subject FROM notifications
     WHERE dismissed_at IS NOT NULL AND kind || ':' || subject = ANY($1)
       AND (kind <> ALL($4)
         OR (dismissed_at >= $2 AND (resolved_at IS NULL OR resolved_at > $3)))`,
    [current, cutoff, rearmed, STATE_KINDS],
  )
  return new Set(rows.map((row) => row.key))
}

/**
 * The alerts to show on the home screen, in the order given. `alerts` must be
 * every current alert, for all accounts, since any hide for an alert not in
 * it is dropped as cleared.
 */
export async function listHomeAlerts(
  db: Db,
  alerts: AccountAlert[],
  now: Date,
): Promise<AccountAlert[]> {
  const cutoff = new Date(now.getTime() - RESURFACE_AFTER_MS)
  const keys = alerts.map(alertKey)
  await pruneHides(db, keys, cutoff)
  if (alerts.length === 0) return []
  const away = await putAwayKeys(db, keys, cutoff, new Date(now.getTime() - REARM_AFTER_MS))
  return alerts.filter((alert, index) => !away.has(keys[index]!))
}

/**
 * Hides one of the current alerts from the home screen for a day, leaving the
 * inbox as it was. Hiding it again starts the day over. An alert that is not
 * current (it cleared a moment ago) is not found.
 */
export async function hideHomeAlert(
  db: Db,
  alerts: AccountAlert[],
  target: { kind: AlertKind; accountId: string },
  now: Date,
): Promise<void> {
  const alert = alerts.find((one) => one.kind === target.kind && one.accountId === target.accountId)
  if (!alert) throw notFound('Alert')
  await db.query(
    `INSERT INTO alert_hides (kind, subject, hidden_at) VALUES ($1, $2, $3)
     ON CONFLICT (kind, subject) DO UPDATE SET hidden_at = excluded.hidden_at`,
    [alert.kind, accountAlertSubject(alert), now],
  )
}
