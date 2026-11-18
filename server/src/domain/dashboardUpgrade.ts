// Puts the new summary widget at the top of dashboards saved before it
// existed. Runs once per install at startup; a dashboard the owner arranges
// afterwards is left alone, even if they remove the summary.

import type pg from 'pg'
import { withTransaction } from '../db/pool.js'
import { getSettings, saveSettings } from './settings.js'

/** The name this upgrade is recorded under in applied_upgrades. */
const SUMMARY_WIDGET_UPGRADE = 'summary-widget'

/** Returns true when the summary was added to a saved dashboard. */
export async function addSummaryWidget(pool: pg.Pool): Promise<boolean> {
  return withTransaction(pool, async (db) => {
    const { rowCount } = await db.query(
      'INSERT INTO applied_upgrades (name) VALUES ($1) ON CONFLICT DO NOTHING',
      [SUMMARY_WIDGET_UPGRADE],
    )
    // Already applied on an earlier start.
    if (rowCount === 0) return false
    const settings = await getSettings(db)
    const { widgets } = settings.dashboard
    if (widgets.some((w) => w.type === 'summary')) return false
    const summary = { type: 'summary' as const, size: 'full' as const, visible: true }
    await saveSettings(db, { ...settings, dashboard: { widgets: [summary, ...widgets] } })
    return true
  })
}
