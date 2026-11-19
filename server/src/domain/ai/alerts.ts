// Spending alerts, each raised once a month: a warning at WARN_AT_PERCENT of
// the limit, and the limit itself when a call is turned away. The owner can
// dismiss them; a new month starts with none.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'

export type SpendAlertLevel = 'warning' | 'limit'

/** Raises an alert for the month, unless it was raised already. */
export async function raiseSpendAlert(
  db: Db,
  month: IsoDate,
  level: SpendAlertLevel,
  at: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO ai_spend_alerts (month, level, raised_at) VALUES ($1, $2, $3)
     ON CONFLICT (month, level) DO NOTHING`,
    [month, level, at],
  )
}

/** The month's alert the owner has not dismissed, the limit before the warning. */
export async function activeSpendAlert(db: Db, month: IsoDate): Promise<SpendAlertLevel | null> {
  const { rows } = await db.query<{ level: SpendAlertLevel }>(
    `SELECT level FROM ai_spend_alerts
     WHERE month = $1 AND dismissed_at IS NULL
     ORDER BY level = 'limit' DESC LIMIT 1`,
    [month],
  )
  return rows[0]?.level ?? null
}

/** Dismisses the month's alerts. One raised later in the month still shows. */
export async function dismissSpendAlerts(db: Db, month: IsoDate, at: Date): Promise<void> {
  await db.query(
    'UPDATE ai_spend_alerts SET dismissed_at = $2 WHERE month = $1 AND dismissed_at IS NULL',
    [month, at],
  )
}

/**
 * Forgets the month's alerts when the owner changes the limit, so each is
 * raised again, once, against the new limit.
 */
export async function clearSpendAlerts(db: Db, month: IsoDate): Promise<void> {
  await db.query('DELETE FROM ai_spend_alerts WHERE month = $1', [month])
}
