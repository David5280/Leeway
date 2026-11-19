// Spending alerts, each raised once a month: a warning at WARN_AT_PERCENT of
// the limit, and the limit itself when a call is turned away. The owner can
// dismiss them; a new month starts with none. Each is also news for the
// notification inbox, told once, as it is raised.

import { centsOfMicros } from '../../ai/models.js'
import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { formatCents } from '../../lib/money.js'
import { shortDate } from '../../lib/words.js'
import { notifySpendAlert } from '../notifications/aiLimit.js'
import type { Settings } from '../settings.js'
import type { AiMonth } from './month.js'

export type SpendAlertLevel = 'warning' | 'limit'

/** An alert as it is raised: its level, and the month's spending and limit then. */
export interface SpendAlertRaise {
  month: Pick<AiMonth, 'start' | 'resetsOn'>
  level: SpendAlertLevel
  spentMicros: number
  settings: Pick<Settings, 'locale' | 'ai'>
}

/**
 * Raises an alert for the month, unless it was raised already. Only an alert
 * raised just now goes to the inbox, so each is told once, however many
 * calls find the month past the mark.
 */
export async function raiseSpendAlert(db: Db, alert: SpendAlertRaise, at: Date): Promise<void> {
  const { month, level, spentMicros, settings } = alert
  const { rowCount } = await db.query(
    `INSERT INTO ai_spend_alerts (month, level, raised_at) VALUES ($1, $2, $3)
     ON CONFLICT (month, level) DO NOTHING`,
    [month.start, level, at],
  )
  if (!rowCount) return
  await notifySpendAlert(
    db,
    {
      month: month.start,
      level,
      capCents: settings.ai.monthlyCapCents,
      message: spendAlertMessage(level, spentMicros, settings, month.resetsOn),
    },
    at,
  )
}

/** An alert in the owner's language. */
export function spendAlertMessage(
  level: SpendAlertLevel,
  spentMicros: number,
  settings: Pick<Settings, 'locale' | 'ai'>,
  resetsOn: IsoDate,
): string {
  const usd = (cents: number) => formatCents(cents, 'USD', settings.locale)
  const cap = usd(settings.ai.monthlyCapCents)
  const resets = shortDate(resetsOn, settings.locale)
  if (level === 'limit') {
    return `This month's AI limit of ${cap} is reached, so Leeway writes the summary itself and can't read paystubs until ${resets}. You can raise the limit in Settings, then AI models.`
  }
  return `AI has spent ${usd(centsOfMicros(spentMicros))} of this month's ${cap} limit. It resets on ${resets}.`
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
