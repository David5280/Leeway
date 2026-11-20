// The account alerts the home screen shows: every current alert, less the
// ones the owner put away. An alert goes from home when it is hidden there,
// which leaves the inbox alone, or dismissed in the inbox.
//
// A hide follows the same rules as a dismissal, so home and the inbox agree:
// - a condition (overdrawn, over its limit, low) is away for a day while it
//   holds (RESURFACE_AFTER_MS), then shows again;
// - a fee is news, so it is away for good, until a newer fee comes;
// - an alert that clears and comes back over an hour later (REARM_AFTER_MS)
//   is a new run of it and shows afresh, while one that flickers back sooner
//   stays away, as the inbox treats it;
// - a dismissal counts only while its kind is turned on, as the inbox shows
//   only those kinds and keeps only them current.
//
// The home list only reads. The notifier keeps hides current: it notes when
// each hidden alert is gone and drops the hides that no longer count.

import type { Db } from '../../db/pool.js'
import { notFound } from '../../errors.js'
import { todayIn } from '../../lib/dates.js'
import type { AccountAlert, AlertKind } from '../accountAlerts.js'
import { listAlerts } from '../alerts.js'
import { getSettings } from '../settings.js'
import { keyOf, REARM_AFTER_MS, RESURFACE_AFTER_MS } from './inbox.js'
import { RESURFACE_KINDS, type NotificationKind } from './settings.js'
import { accountAlertSubject } from './words.js'

/** The home list: what to show, and how many current alerts are put away. */
export interface HomeAlerts {
  alerts: AccountAlert[]
  hidden: number
}

/** An alert's key, as its notification and its home hide are both stored. */
const alertKey = (alert: AccountAlert): string =>
  keyOf({ kind: alert.kind, subject: accountAlertSubject(alert) })

/** Every current alert, for every account, whichever notifications are on. */
export async function currentAlerts(db: Db, now: Date): Promise<AccountAlert[]> {
  const settings = await getSettings(db)
  return listAlerts(db, settings, todayIn(settings.timeZone, now))
}

/**
 * A condition's hide that no longer counts: over a day old, or its alert came
 * back as a new run since (its notification is newer). A fee's hide is never
 * spent this way. Its subject is that one fee, so a newer notification for it
 * (fee notifications turned on later, say) is the same fee, which the owner
 * already put away for good; a newer fee has a subject of its own. The SQL
 * reads alert_hides as h; $1 is the cutoff a day back, $2 the kinds whose
 * hides last a day.
 */
const SPENT_HIDE = `(h.kind = ANY($2) AND (h.hidden_at < $1
  OR EXISTS (SELECT 1 FROM notifications n
    WHERE n.kind = h.kind AND n.subject = h.subject AND n.created_at > h.hidden_at)))`

/**
 * The keys, among `current` ($3), of alerts put away from home: hidden there
 * and still counting, with the alert not gone for over an hour since ($4), or
 * dismissed in the inbox, of a kind turned on ($5), and still within its rule.
 * A dismissed condition counts for a day while its notification still stands
 * for this run of it; a dismissed fee counts for good. A kind turned off is
 * not kept current, so its dismissal would never see the alert clear.
 */
async function putAwayKeys(
  db: Db,
  current: string[],
  on: NotificationKind[],
  now: Date,
): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(
    `SELECT h.kind || ':' || h.subject AS key FROM alert_hides h
     WHERE h.kind || ':' || h.subject = ANY($3) AND NOT ${SPENT_HIDE}
       AND (h.cleared_at IS NULL OR h.cleared_at > $4)
     UNION
     SELECT kind || ':' || subject FROM notifications
     WHERE dismissed_at IS NOT NULL AND kind || ':' || subject = ANY($3) AND kind = ANY($5)
       AND (kind <> ALL($2)
         OR (dismissed_at >= $1 AND (resolved_at IS NULL OR resolved_at > $4)))`,
    [
      new Date(now.getTime() - RESURFACE_AFTER_MS),
      RESURFACE_KINDS,
      current,
      new Date(now.getTime() - REARM_AFTER_MS),
      on,
    ],
  )
  return new Set(rows.map((row) => row.key))
}

/**
 * The alerts to show on the home screen, in the order given, from every
 * current alert and the notification kinds turned on.
 */
export async function listHomeAlerts(
  db: Db,
  alerts: AccountAlert[],
  on: NotificationKind[],
  now: Date,
): Promise<HomeAlerts> {
  if (alerts.length === 0) return { alerts: [], hidden: 0 }
  const keys = alerts.map(alertKey)
  const away = await putAwayKeys(db, keys, on, now)
  const shown = alerts.filter((_alert, index) => !away.has(keys[index]!))
  return { alerts: shown, hidden: alerts.length - shown.length }
}

/**
 * Hides one of the current alerts from the home screen, leaving the inbox as
 * it was. Hiding it again starts it over, as a fresh hide the notifier has
 * not yet seen gone. An alert that is not current (it cleared a moment ago)
 * is not found. Its notification should be recorded first, so this run's
 * notification is never newer than its hide.
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
     ON CONFLICT (kind, subject) DO UPDATE SET hidden_at = excluded.hidden_at, cleared_at = NULL`,
    [alert.kind, accountAlertSubject(alert), now],
  )
}

/**
 * Keeps the hides current, from every alert there is now: drops the spent
 * ones and those whose alert has been gone for over an hour, then notes which
 * of the rest are gone. Dropping comes first, so an alert back after a long
 * absence is never mistaken for one that only flickered.
 */
export async function trackHomeHides(db: Db, alerts: AccountAlert[], now: Date): Promise<void> {
  await db.query(`DELETE FROM alert_hides h WHERE ${SPENT_HIDE} OR h.cleared_at <= $3`, [
    new Date(now.getTime() - RESURFACE_AFTER_MS),
    RESURFACE_KINDS,
    new Date(now.getTime() - REARM_AFTER_MS),
  ])
  await db.query(
    `UPDATE alert_hides SET cleared_at = CASE
       WHEN kind || ':' || subject = ANY($1) THEN NULL ELSE coalesce(cleared_at, $2) END`,
    [alerts.map(alertKey), now],
  )
}
