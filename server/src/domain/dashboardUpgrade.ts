// One-time changes to saved dashboards, run once per install at startup:
// the summary widget added to dashboards saved before it existed, today's
// default Home given to a dashboard still in any default it replaced, and
// each new kind of card added once to a dashboard the owner arranged. A new
// kind of card reaches every Home this way; the owner's order, sizes and
// hidden cards are kept.

import type pg from 'pg'
import { withTransaction } from '../db/pool.js'
import { isOlderDefault, withNewBlocks } from './homeLayouts.js'
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

/** The dashboard's widgets exactly as stored, or null when none was ever saved. */
async function storedWidgets(db: pg.PoolClient): Promise<unknown> {
  const { rows } = await db.query<{ widgets: unknown }>(
    "SELECT data->'dashboard'->'widgets' AS widgets FROM settings",
  )
  return rows[0]?.widgets ?? null
}

/**
 * Gives a dashboard still in any older default today's default Home: Leeway,
 * Heads up, the accounts, the bills due by payday, the latest activity and a row
 * of each tab's summary. Returns true when it changed a saved dashboard.
 */
export async function upgradeDefaultHome(pool: pg.Pool): Promise<boolean> {
  return withTransaction(pool, async (db) => {
    if (!(await firstRun(db, DEFAULT_HOME_UPGRADE))) return false
    // A layout the owner arranged is left to addNewHomeBlocks, which keeps it.
    if (!isOlderDefault(await storedWidgets(db))) return false
    const settings = await getSettings(db)
    await saveSettings(db, { ...settings, dashboard: { widgets: DEFAULT_WIDGETS } })
    return true
  })
}

/**
 * The name the new Home blocks are recorded under in applied_upgrades. It is
 * new because "home-accounts" first matched older defaults size for size, so
 * an install with one card resized ran it and kept its old Home.
 */
const HOME_BLOCKS_UPGRADE = 'home-blocks'

/**
 * Brings the new kinds of card to a saved Home that does not have them yet.
 * A dashboard still in an older default, with any sizes, moves to today's
 * default; one the owner arranged keeps its order, sizes and hidden cards and
 * gains each missing card once (homeLayouts.ts). Runs after
 * upgradeDefaultHome. Returns true when it changed a saved dashboard.
 */
export async function addNewHomeBlocks(pool: pg.Pool): Promise<boolean> {
  return withTransaction(pool, async (db) => {
    if (!(await firstRun(db, HOME_BLOCKS_UPGRADE))) return false
    // A dashboard never saved opens with today's default, which needs no upgrade.
    const stored = await storedWidgets(db)
    if (stored === null) return false
    const settings = await getSettings(db)
    const widgets = isOlderDefault(stored)
      ? DEFAULT_WIDGETS
      : withNewBlocks(settings.dashboard.widgets)
    if (!widgets) return false
    await saveSettings(db, { ...settings, dashboard: { widgets } })
    return true
  })
}
