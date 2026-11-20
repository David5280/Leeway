// One-time changes to saved dashboards, run once per install at startup:
// the summary widget added to dashboards saved before it existed, and the
// Overview's new order given to dashboards still in the old default order.
// A dashboard the owner arranges afterwards is left alone.

import type pg from 'pg'
import { withTransaction } from '../db/pool.js'
import { DEFAULT_WIDGETS, getSettings, saveSettings, type Settings } from './settings.js'

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

/** The name the new order is recorded under in applied_upgrades. */
const LEEWAY_FIRST_UPGRADE = 'leeway-first'

/** The default Overview before it led with what is left to spend. */
const SUMMARY_FIRST: Settings['dashboard']['widgets'] = [
  { type: 'summary', size: 'full', visible: true },
  { type: 'leeway', size: 'wide', visible: true },
  { type: 'glance', size: 'half', visible: true },
  { type: 'alerts', size: 'full', visible: true },
  { type: 'categories', size: 'wide', visible: true },
  { type: 'pace', size: 'half', visible: true },
  { type: 'recent', size: 'wide', visible: true },
  { type: 'accounts', size: 'half', visible: true },
]

/** Whether two widget lists are the same widgets, sizes and visibility, in the same order. */
const sameLayout = (a: Settings['dashboard']['widgets'], b: typeof a) =>
  a.length === b.length &&
  a.every((w, i) => w.type === b[i]!.type && w.size === b[i]!.size && w.visible === b[i]!.visible)

/**
 * Gives a dashboard still in the old default order the new one, which leads
 * with what is left to spend. Returns true when it changed a saved dashboard.
 */
export async function leadWithLeeway(pool: pg.Pool): Promise<boolean> {
  return withTransaction(pool, async (db) => {
    const { rowCount } = await db.query(
      'INSERT INTO applied_upgrades (name) VALUES ($1) ON CONFLICT DO NOTHING',
      [LEEWAY_FIRST_UPGRADE],
    )
    // Already applied on an earlier start.
    if (rowCount === 0) return false
    const settings = await getSettings(db)
    // An order the owner chose is theirs to keep.
    if (!sameLayout(settings.dashboard.widgets, SUMMARY_FIRST)) return false
    await saveSettings(db, { ...settings, dashboard: { widgets: DEFAULT_WIDGETS } })
    return true
  })
}
