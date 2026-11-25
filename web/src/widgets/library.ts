// The cards Home can draw, and changes to Home's card list.
//
// Home reads top to bottom as the map has it: Leeway (what you can spend),
// Heads up (only when something needs the owner), then one summary card per
// tab. Leeway and Heads up are fixed: Home draws them itself, first, so
// nothing urgent can be hidden or moved down. They stay in the saved list
// (the server's default names them) but are not in the library, so the
// layout tools never offer them. Every library card is a summary that opens
// its tab or a page a tap deeper, never a second place to act.

import type { ComponentType } from 'react'
import type { Settings } from '../api/client'
import type { PlaceId } from '../lib/places'
import { DebtsWidget, MerchantsWidget, TrendsWidget } from './Shortcuts'
import { SummaryWidget } from './Summary'
import { CashToPaydayCard, NetWorthCard, SpendingPaceCard, TopGoalCard } from './TabCards'
import { sharesLane } from './arrange'
import type { WidgetProps } from './types'

export type Widget = Settings['dashboard']['widgets'][number]
export type WidgetType = Widget['type']

/** One card Home can draw. */
export interface WidgetEntry {
  name: string
  component: ComponentType<WidgetProps>
  /**
   * The tab whose figures it shows, and which it opens, so its label wears
   * that tab's color (lib/places.ts). A card that belongs to no tab stays plain.
   */
  place?: Exclude<PlaceId, 'home'>
}

/**
 * The cards the owner can arrange, in the order the library lists them: the
 * four tab cards, then optional ones. Leeway and Heads up are not listed:
 * they keep their place in the saved list but are drawn fixed at the top.
 * The server drops a card kind it no longer knows on read and refuses one on
 * save, so the saved list holds nothing else.
 */
export const WIDGET_LIBRARY: Partial<Record<WidgetType, WidgetEntry>> = {
  'cash-flow': { name: 'Cash to payday', component: CashToPaydayCard, place: 'pay' },
  pace: { name: 'Spending pace', component: SpendingPaceCard, place: 'spend' },
  goals: { name: 'Your top goal', component: TopGoalCard, place: 'goal' },
  'net-worth': { name: 'Net worth', component: NetWorthCard, place: 'wealth' },
  summary: { name: 'Summary', component: SummaryWidget },
  trends: { name: 'Spending over time', component: TrendsWidget, place: 'spend' },
  merchants: { name: 'Top merchants', component: MerchantsWidget, place: 'spend' },
  debts: { name: 'Debt payoff', component: DebtsWidget, place: 'wealth' },
}

/**
 * Home as it first opens, and what "Reset layout" puts back: Leeway, Heads
 * up, then the four tab cards in the map's order. The same list as the
 * server's DEFAULT_WIDGETS (server/src/domain/settings.ts).
 */
export const DEFAULT_LAYOUT: Widget[] = [
  { type: 'leeway', size: 'wide', visible: true },
  { type: 'alerts', size: 'full', visible: true },
  { type: 'cash-flow', size: 'half', visible: true },
  { type: 'pace', size: 'half', visible: true },
  { type: 'goals', size: 'half', visible: true },
  { type: 'net-worth', size: 'half', visible: true },
]

export const SIZES = [
  { value: 'half', label: 'Half' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
] as const

const canDraw = (widget: Widget) => WIDGET_LIBRARY[widget.type] !== undefined

/** The cards the owner arranges, in their saved order: all but the fixed Leeway and Heads up. */
export const drawable = (widgets: Widget[]) => widgets.filter(canDraw)

/** Library cards not on Home yet. */
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
 * over the fixed cards and any that sit in another column, so every move
 * visibly does something. At either end the list comes back unchanged.
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
