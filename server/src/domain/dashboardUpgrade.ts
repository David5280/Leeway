// One-time changes to saved dashboards, run once per install at startup:
// the summary widget added to dashboards saved before it existed, and
// today's default Home given to a dashboard still in any default it
// replaced. A dashboard the owner arranged is left alone.

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

/**
 * The name today's default Home is recorded under in applied_upgrades. It is
 * new with the accounts on Home: the upgrade before it ("home-map") already
 * ran on installs that had the map order, so a new name lets those move on.
 */
const DEFAULT_HOME_UPGRADE = 'home-accounts'

/** A widget as an older Leeway stored it, possibly of a kind since removed. */
interface StoredWidget {
  type: string
  size: string
  visible: boolean
}

/** Every widget in a default layout of the time is shown. */
const shown = (type: string, size: string): StoredWidget => ({ type, size, visible: true })

/**
 * Every default Home an install may still have stored, oldest first. Most
 * name cards since removed, which reading the settings drops, so the stored
 * list itself is compared rather than the settings read back. An install
 * that skipped versions never ran the upgrades between, so each one moves
 * straight to today's default.
 */
const OLDER_DEFAULTS: readonly (readonly StoredWidget[])[] = [
  // Summary first, as dashboards were before the Overview led with Leeway.
  [
    shown('summary', 'full'),
    shown('leeway', 'wide'),
    shown('glance', 'half'),
    shown('alerts', 'full'),
    shown('categories', 'wide'),
    shown('pace', 'half'),
    shown('recent', 'wide'),
    shown('accounts', 'half'),
  ],
  // Leeway first, before the income and spending card existed.
  [
    shown('leeway', 'wide'),
    shown('alerts', 'full'),
    shown('summary', 'full'),
    shown('pace', 'full'),
    shown('glance', 'full'),
    shown('categories', 'wide'),
    shown('accounts', 'half'),
    shown('recent', 'wide'),
  ],
  // The same, once the income and spending card was added before the pace.
  [
    shown('leeway', 'wide'),
    shown('alerts', 'full'),
    shown('summary', 'full'),
    shown('flows', 'full'),
    shown('pace', 'full'),
    shown('glance', 'full'),
    shown('categories', 'wide'),
    shown('accounts', 'half'),
    shown('recent', 'wide'),
  ],
  // The default just before Home followed the map.
  [
    shown('leeway', 'wide'),
    shown('net-worth', 'half'),
    shown('alerts', 'full'),
    shown('flows', 'full'),
    shown('pace', 'full'),
  ],
  // The map order: Leeway, Heads up, then one card per tab, each on its own.
  [
    shown('leeway', 'wide'),
    shown('alerts', 'full'),
    shown('cash-flow', 'half'),
    shown('pace', 'half'),
    shown('goals', 'half'),
    shown('net-worth', 'half'),
  ],
]

/** The dashboard's widgets exactly as stored, or null when none was ever saved. */
async function storedWidgets(db: pg.PoolClient): Promise<unknown> {
  const { rows } = await db.query<{ widgets: unknown }>(
    "SELECT data->'dashboard'->'widgets' AS widgets FROM settings",
  )
  return rows[0]?.widgets ?? null
}

/** Whether a stored list is that layout: the same widgets, sizes and visibility, in order. */
function sameLayout(stored: unknown, layout: readonly StoredWidget[]): boolean {
  if (!Array.isArray(stored) || stored.length !== layout.length) return false
  return layout.every((widget, i) => {
    const saved = stored[i] as Partial<StoredWidget> | null
    return (
      saved?.type === widget.type && saved.size === widget.size && saved.visible === widget.visible
    )
  })
}

/** Whether a stored list is exactly one of the older defaults, so the owner never arranged it. */
const isOlderDefault = (stored: unknown) =>
  OLDER_DEFAULTS.some((layout) => sameLayout(stored, layout))

/**
 * Gives a dashboard still in any older default today's default Home: Leeway,
 * Heads up, the accounts, the bills coming up, the latest activity and a row
 * of each tab's summary. Returns true when it changed a saved dashboard.
 */
export async function upgradeDefaultHome(pool: pg.Pool): Promise<boolean> {
  return withTransaction(pool, async (db) => {
    if (!(await firstRun(db, DEFAULT_HOME_UPGRADE))) return false
    // An order the owner chose is theirs to keep: nothing is added to it.
    if (!isOlderDefault(await storedWidgets(db))) return false
    const settings = await getSettings(db)
    await saveSettings(db, { ...settings, dashboard: { widgets: DEFAULT_WIDGETS } })
    return true
  })
}
