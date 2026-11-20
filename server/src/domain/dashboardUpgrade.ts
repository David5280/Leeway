// One-time changes to saved dashboards, run once per install at startup:
// the summary widget added to dashboards saved before it existed, the
// Overview's new order given to dashboards still in the old default order,
// and the income and spending chart added to an arranged dashboard that never
// had it. A dashboard the owner arranges afterwards is left alone.

import type pg from 'pg'
import { withTransaction } from '../db/pool.js'
import { DEFAULT_WIDGETS, getSettings, saveSettings, type Settings } from './settings.js'

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
    if (!(await firstRun(db, LEEWAY_FIRST_UPGRADE))) return false
    const settings = await getSettings(db)
    // An order the owner chose is theirs to keep.
    if (!sameLayout(settings.dashboard.widgets, SUMMARY_FIRST)) return false
    await saveSettings(db, { ...settings, dashboard: { widgets: DEFAULT_WIDGETS } })
    return true
  })
}

/** The name the income and spending chart's addition is recorded under in applied_upgrades. */
const FLOWS_WIDGET_UPGRADE = 'flows-widget'

type Widgets = Settings['dashboard']['widgets']

/**
 * The widgets with the income and spending chart added where the default
 * Overview has it: just before the spending pace, or else after what is left
 * to spend, or else last. Every other widget keeps its place.
 */
export function withFlows(widgets: Widgets): Widgets {
  const flows = { type: 'flows' as const, size: 'full' as const, visible: true }
  const pace = widgets.findIndex((w) => w.type === 'pace')
  const leeway = widgets.findIndex((w) => w.type === 'leeway')
  let at = widgets.length
  if (pace !== -1) at = pace
  else if (leeway !== -1) at = leeway + 1
  return [...widgets.slice(0, at), flows, ...widgets.slice(at)]
}

/**
 * Adds the income and spending chart to a saved dashboard arranged before it
 * existed. Returns true when it changed a saved dashboard.
 */
export async function addFlowsWidget(pool: pg.Pool): Promise<boolean> {
  return withTransaction(pool, async (db) => {
    if (!(await firstRun(db, FLOWS_WIDGET_UPGRADE))) return false
    // A dashboard never saved opens with today's default, which has it.
    if (!(await dashboardSaved(db))) return false
    const settings = await getSettings(db)
    const { widgets } = settings.dashboard
    if (widgets.some((w) => w.type === 'flows')) return false
    await saveSettings(db, { ...settings, dashboard: { widgets: withFlows(widgets) } })
    return true
  })
}
