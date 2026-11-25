// Home layouts as older Leeway versions stored them, and how a saved layout
// takes in the kinds of card added since. dashboardUpgrade.ts runs both once
// per install. Kept free of the database so each rule is tested on its own.

import { IN_TAB_ROW } from './homeCards.js'
import { DEFAULT_WIDGETS, settingsSchema, type Settings } from './settings.js'

/** A widget as an older Leeway stored it, possibly of a kind since removed. */
interface StoredWidget {
  type: string
  size: string
  visible: boolean
}

/** A widget as the settings read it back today. */
type Widget = Settings['dashboard']['widgets'][number]

/** Every widget in a default layout of the time is shown. */
const shown = (type: string, size: string): StoredWidget => ({ type, size, visible: true })

/**
 * Every default Home an install may still have stored, oldest first. Most
 * name cards since removed, which reading the settings drops, so the stored
 * list itself is compared rather than the settings read back. An install
 * that skipped versions never ran the upgrades between, so each one moves
 * straight to today's default.
 */
export const OLDER_DEFAULTS: readonly (readonly StoredWidget[])[] = [
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

/**
 * Whether a stored list is that layout: the same cards, shown or hidden
 * alike, in the same order. Sizes are not compared: resizing a card is not
 * arranging Home, and a default with one card made smaller is still one the
 * owner never laid out.
 */
function sameLayout(stored: unknown, layout: readonly StoredWidget[]): boolean {
  if (!Array.isArray(stored) || stored.length !== layout.length) return false
  return layout.every((widget, i) => {
    const saved = stored[i] as Partial<StoredWidget> | null
    return saved?.type === widget.type && saved.visible === widget.visible
  })
}

/** Whether a stored list is one of the older defaults, sizes aside, so the owner never arranged it. */
export const isOlderDefault = (stored: unknown): boolean =>
  OLDER_DEFAULTS.some((layout) => sameLayout(stored, layout))

/** The cards new with the accounts on Home, in the order they follow Heads up. */
const NEW_BLOCKS = ['account-list', 'coming-up', 'latest-activity'] as const

/** Today's default card of a kind, shown at its default size. */
const defaultCard = (type: Widget['type']): Widget =>
  DEFAULT_WIDGETS.find((widget) => widget.type === type) ?? { type, size: 'wide', visible: true }

/**
 * A layout the owner arranged, with each kind of card new to Home that it
 * lacks added once: the accounts, the bills due by payday and the latest
 * activity right after Leeway and Heads up, and the tab row at the end. The
 * owner's order, sizes and hidden cards are kept, and a card they hid is not
 * added again. The tab row is added only when no tab card is there on its
 * own, so no figure shows twice. Null when nothing is missing, or when the
 * result would be a layout the settings refuse.
 */
export function withNewBlocks(widgets: readonly Widget[]): Widget[] | null {
  const has = (type: string) => widgets.some((widget) => widget.type === type)
  const blocks = NEW_BLOCKS.filter((type) => !has(type)).map(defaultCard)
  const addRow = !has('tab-row') && !IN_TAB_ROW.some(has)
  if (blocks.length === 0 && !addRow) return null

  // Leeway and Heads up lead Home; the new cards go just after whichever comes last.
  const leading = widgets.findLastIndex((w) => w.type === 'leeway' || w.type === 'alerts')
  const at = leading + 1
  const result = [
    ...widgets.slice(0, at),
    ...blocks,
    ...widgets.slice(at),
    ...(addRow ? [defaultCard('tab-row')] : []),
  ]
  return dashboardAccepted(result) ? result : null
}

/** Whether the settings would accept this layout, checked against the schema itself. */
function dashboardAccepted(widgets: Widget[]): boolean {
  return settingsSchema.shape.dashboard.safeParse({ widgets }).success
}
