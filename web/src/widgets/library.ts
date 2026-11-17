// The widgets this app can draw, and changes to the dashboard's widget list.

import type { ComponentType } from 'react'
import type { Settings } from '../api/client'
import { AccountsWidget, MerchantsWidget, RecentWidget } from './Activity'
import { AlertsWidget } from './Alerts'
import { CategoriesWidget } from './Categories'
import { GlanceWidget } from './Glance'
import { LeewayWidget } from './Leeway'
import { PaceWidget } from './Pace'
import { BillsWidget, CashFlowWidget, DebtsWidget, GoalsWidget, NetWorthWidget } from './Planning'
import { TrendsWidget } from './Trends'
import type { WidgetProps } from './types'

export type Widget = Settings['dashboard']['widgets'][number]
export type WidgetType = Widget['type']

/**
 * The widgets that exist so far, in the order the library lists them. Settings
 * may also name widgets a newer Leeway (or an agent) added; those are kept in
 * the saved list but not drawn.
 */
export const WIDGET_LIBRARY: Partial<
  Record<WidgetType, { name: string; component: ComponentType<WidgetProps> }>
> = {
  leeway: { name: 'Your leeway', component: LeewayWidget },
  glance: { name: 'At a glance', component: GlanceWidget },
  alerts: { name: 'Heads up', component: AlertsWidget },
  categories: { name: 'Categories', component: CategoriesWidget },
  pace: { name: 'Spending pace', component: PaceWidget },
  recent: { name: 'Recent', component: RecentWidget },
  accounts: { name: 'Accounts', component: AccountsWidget },
  merchants: { name: 'Top merchants', component: MerchantsWidget },
  trends: { name: 'Spending over time', component: TrendsWidget },
  'cash-flow': { name: 'Until payday', component: CashFlowWidget },
  bills: { name: 'Bills', component: BillsWidget },
  goals: { name: 'Goals', component: GoalsWidget },
  debts: { name: 'Debt payoff', component: DebtsWidget },
  'net-worth': { name: 'Net worth', component: NetWorthWidget },
}

export const DEFAULT_LAYOUT: Widget[] = [
  { type: 'leeway', size: 'wide', visible: true },
  { type: 'glance', size: 'half', visible: true },
  { type: 'alerts', size: 'full', visible: true },
  { type: 'categories', size: 'wide', visible: true },
  { type: 'pace', size: 'half', visible: true },
  { type: 'recent', size: 'wide', visible: true },
  { type: 'accounts', size: 'half', visible: true },
]

export const SIZES = [
  { value: 'half', label: 'Half' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
] as const

export const canDraw = (widget: Widget) => WIDGET_LIBRARY[widget.type] !== undefined

/** The widgets this app draws, in their saved order. */
export const drawable = (widgets: Widget[]) => widgets.filter(canDraw)

/** Library widgets not on the dashboard yet. */
export function addableTypes(widgets: Widget[]): WidgetType[] {
  return (Object.keys(WIDGET_LIBRARY) as WidgetType[]).filter(
    (type) => !widgets.some((w) => w.type === type),
  )
}

/** Where the widget at `index` would move: the nearest drawable one that way, or -1 at the end. */
function moveTarget(widgets: Widget[], index: number, by: -1 | 1): number {
  for (let i = index + by; i >= 0 && i < widgets.length; i += by) {
    if (canDraw(widgets[i]!)) return i
  }
  return -1
}

/** Whether the widget can move that way, so the button can be disabled at either end. */
export function canMove(widgets: Widget[], index: number, by: -1 | 1): boolean {
  return moveTarget(widgets, index, by) !== -1
}

/**
 * Swaps a widget with its nearest drawable neighbor, stepping over widgets this
 * app cannot draw so every move visibly does something. At either end the list
 * comes back unchanged.
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
