// One-time changes to saved dashboards, run once per install at startup:
// the summary widget added to dashboards saved before it existed, and Home's
// map order given to a dashboard still in the default it replaced. A
// dashboard the owner arranges afterwards is left alone.

import type pg from 'pg'
import { withTransaction } from '../db/pool.js'
import { DEFAULT_WIDGETS, getSettings, saveSettings } from './settings.js'

/** The name this upgrade is recorded under in applied_upgrades. */
const SUMMARY_WIDGET_UPGRADE = 'summary-widget'

/** Whether the stored settings hold a dashboard, rather than falling back to the default. */
async function dashboardSaved(db: pg.PoolClient): Promise<boolean> {
  const { rows } = await db.query<{ saved: boolean }>(
    "SELECT coalesce(data ? 'dashboard', false) AS saved FROM settings",
  )
  return rows[0]?.saved ?? false
}

/** Records an upgrade as applied; false when an earlier start already applied it. */
async function firstRun(db: pg.PoolClient, name: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'INSERT INTO applied_upgrades (name) VALUES ($1) ON CONFLICT DO NOTHING',
    [name],
  )
  return rowCount !== 0
}

/** Returns true when the summary was added to a saved dashboard. */
export async function addSummaryWidget(pool: pg.Pool): Promise<boolean> {
  return withTransaction(pool, async (db) => {
    if (!(await firstRun(db, SUMMARY_WIDGET_UPGRADE))) return false
    // A dashboard never saved opens with today's default, which needs no upgrade.
    if (!(await dashboardSaved(db))) return false
    const settings = await getSettings(db)
    const { widgets } = settings.dashboard
    if (widgets.some((w) => w.type === 'summary')) return false
    const summary = { type: 'summary' as const, size: 'full' as const, visible: true }
    await saveSettings(db, { ...settings, dashboard: { widgets: [summary, ...widgets] } })
    return true
  })
}

/** The name Home's map order is recorded under in applied_upgrades. */
const HOME_MAP_UPGRADE = 'home-map'

/**
 * The default Home before it followed the map, as stored. It names a card
 * since removed (flows), which reading the settings drops, so the stored
 * list itself is compared rather than the settings read back.
 */
const BEFORE_HOME_MAP = [
  { type: 'leeway', size: 'wide', visible: true },
  { type: 'net-worth', size: 'half', visible: true },
  { type: 'alerts', size: 'full', visible: true },
  { type: 'flows', size: 'full', visible: true },
  { type: 'pace', size: 'full', visible: true },
]

/** The dashboard's widgets exactly as stored, or null when none was ever saved. */
async function storedWidgets(db: pg.PoolClient): Promise<unknown> {
  const { rows } = await db.query<{ widgets: unknown }>(
    "SELECT data->'dashboard'->'widgets' AS widgets FROM settings",
  )
  return rows[0]?.widgets ?? null
}

/** Whether a stored list is that layout: the same widgets, sizes and visibility, in order. */
function sameLayout(stored: unknown, layout: typeof BEFORE_HOME_MAP): boolean {
  if (!Array.isArray(stored) || stored.length !== layout.length) return false
  return layout.every((widget, i) => {
    const saved = stored[i] as Partial<typeof widget> | null
    return (
      saved?.type === widget.type && saved.size === widget.size && saved.visible === widget.visible
    )
  })
}

/**
 * Gives a dashboard still in the default it replaced Home's map order:
 * Leeway, Heads up, then one card per tab. Returns true when it changed a
 * saved dashboard.
 */
export async function followHomeMap(pool: pg.Pool): Promise<boolean> {
  return withTransaction(pool, async (db) => {
    if (!(await firstRun(db, HOME_MAP_UPGRADE))) return false
    // An order the owner chose is theirs to keep.
    if (!sameLayout(await storedWidgets(db), BEFORE_HOME_MAP)) return false
    const settings = await getSettings(db)
    await saveSettings(db, { ...settings, dashboard: { widgets: DEFAULT_WIDGETS } })
    return true
  })
}
