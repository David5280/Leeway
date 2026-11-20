// The widgets this app can draw, and changes to the dashboard's widget list.

import type { ComponentType } from 'react'
import type { Settings } from '../api/client'
import { AccountsWidget, MerchantsWidget, RecentWidget } from './Activity'
import { AlertsWidget } from './Alerts'
import { FlowsWidget } from './Flows'
import { CategoriesWidget } from './Categories'
import { GlanceWidget } from './Glance'
import { LeewayWidget } from './Leeway'
import { PaceWidget } from './Pace'
import { BillsWidget, CashFlowWidget, DebtsWidget, GoalsWidget, NetWorthWidget } from './Planning'
import { arrange, sharesLane } from './arrange'
import { SummaryWidget } from './Summary'
import { TrendsWidget } from './Trends'
import type { WidgetProps } from './types'

export type Widget = Settings['dashboard']['widgets'][number]
export type WidgetType = Widget['type']

/**
 * How general a widget's answer is, most general first: "am I OK?", what needs
 * the owner, the period in words, how it is trending, the quick numbers that
 * need action, where the money went, and the lists. The default Overview reads
 * in this order, from the most general answer down to the most detail.
 */
export const DEPTHS = ['answer', 'alerts', 'words', 'trend', 'tiles', 'breakdown', 'list'] as const
export type Depth = (typeof DEPTHS)[number]

/**
 * The widgets that exist so far, in the order the library lists them. Settings
 * may also name widgets a newer Leeway (or an agent) added; those are kept in
 * the saved list but not drawn.
 */
export const WIDGET_LIBRARY: Partial<
  Record<WidgetType, { name: string; component: ComponentType<WidgetProps>; depth: Depth }>
> = {
  summary: { name: 'Summary', component: SummaryWidget, depth: 'words' },
  leeway: { name: 'Your leeway', component: LeewayWidget, depth: 'answer' },
  glance: { name: 'At a glance', component: GlanceWidget, depth: 'tiles' },
  alerts: { name: 'Heads up', component: AlertsWidget, depth: 'alerts' },
  categories: { name: 'Categories', component: CategoriesWidget, depth: 'breakdown' },
  pace: { name: 'Spending pace', component: PaceWidget, depth: 'trend' },
  recent: { name: 'Recent', component: RecentWidget, depth: 'list' },
  accounts: { name: 'Accounts', component: AccountsWidget, depth: 'list' },
  merchants: { name: 'Top merchants', component: MerchantsWidget, depth: 'breakdown' },
  trends: { name: 'Spending over time', component: TrendsWidget, depth: 'trend' },
  'cash-flow': { name: 'Until payday', component: CashFlowWidget, depth: 'trend' },
  bills: { name: 'Bills', component: BillsWidget, depth: 'list' },
  goals: { name: 'Goals', component: GoalsWidget, depth: 'list' },
  debts: { name: 'Debt payoff', component: DebtsWidget, depth: 'breakdown' },
  'net-worth': { name: 'Net worth', component: NetWorthWidget, depth: 'answer' },
  flows: { name: 'Money in and out', component: FlowsWidget, depth: 'trend' },
}

/**
 * The Overview as it first opens, and what "Reset layout" puts back: only
 * what answers "am I OK?", from the most general answer to the most detail
 * (DEPTHS). The same list as the server's DEFAULT_WIDGETS
 * (server/src/domain/settings.ts).
 */
export const DEFAULT_LAYOUT: Widget[] = [
  { type: 'leeway', size: 'wide', visible: true },
  { type: 'net-worth', size: 'half', visible: true },
  { type: 'alerts', size: 'full', visible: true },
  { type: 'flows', size: 'full', visible: true },
  { type: 'pace', size: 'full', visible: true },
]

/**
 * The widgets as drawn while Heads up holds something urgent (an overdrawn
 * account, a budget gone over): Heads up moves up to just under the hero, at
 * full width, so money going wrong shows above the fold on every screen.
 * It only ever moves up, nothing else moves, and the saved layout stays as
 * the owner left it. With no hero shown, it leads.
 */
export function urgentFirst(widgets: Widget[]): Widget[] {
  const alerts = widgets.find((widget) => widget.type === 'alerts')
  if (!alerts) return widgets
  const rest = widgets.filter((widget) => widget !== alerts)
  const hero = rest.findIndex((widget) => widget.type === 'leeway')
  const at = Math.min(widgets.indexOf(alerts), hero + 1)
  return [...rest.slice(0, at), { ...alerts, size: 'full' }, ...rest.slice(at)]
}

/**
 * Whether widgets read from the most general answer down to the most detail
 * (DEPTHS) as a phone stacks them: each band's columns one after another.
 */
export function readsGeneralFirst(widgets: Widget[]): boolean {
  const drawn = arrange(drawable(widgets)).flatMap((band) => {
    if (band.kind === 'full') return [band.widget]
    return band.kind === 'split' ? [...band.main, ...band.side] : band.columns.flat()
  })
  const depths = drawn.map((widget) => DEPTHS.indexOf(WIDGET_LIBRARY[widget.type]!.depth))
  return depths.every((depth, i) => i === 0 || depth >= depths[i - 1]!)
}

export const SIZES = [
  { value: 'half', label: 'Half' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
] as const

const canDraw = (widget: Widget) => WIDGET_LIBRARY[widget.type] !== undefined

/** The widgets this app draws, in their saved order. */
export const drawable = (widgets: Widget[]) => widgets.filter(canDraw)

/** Library widgets not on the dashboard yet. */
export function addableTypes(widgets: Widget[]): WidgetType[] {
  return (Object.keys(WIDGET_LIBRARY) as WidgetType[]).filter(
    (type) => !widgets.some((w) => w.type === type),
  )
}

/**
 * Where the widget at `index` would move: the nearest drawable one that way in
 * the same lane (see arrange.ts), or -1 when there is none.
 */
function moveTarget(widgets: Widget[], index: number, by: -1 | 1): number {
  const moving = widgets[index]!
  for (let i = index + by; i >= 0 && i < widgets.length; i += by) {
    if (canDraw(widgets[i]!) && sharesLane(moving, widgets[i]!)) return i
  }
  return -1
}

/** Whether the widget can move that way, so the button can be disabled at either end. */
export function canMove(widgets: Widget[], index: number, by: -1 | 1): boolean {
  return moveTarget(widgets, index, by) !== -1
}

/**
 * Swaps a widget with its nearest drawable neighbor in the same lane, stepping
 * over widgets this app cannot draw or that sit in another column, so every
 * move visibly does something. At either end the list comes back unchanged.
 */
export function moveWidget(widgets: Widget[], index: number, by: -1 | 1): Widget[] {
  const target = moveTarget(widgets, index, by)
  if (target === -1) return widgets
  const next = [...widgets]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

/** The list with one widget changed. Widgets are unique by type. */
export function changeWidget(widgets: Widget[], type: WidgetType, change: Partial<Widget>) {
  return widgets.map((w) => (w.type === type ? { ...w, ...change } : w))
}
