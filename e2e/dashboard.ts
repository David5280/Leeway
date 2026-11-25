// Home opens with Leeway, Heads up, the accounts, the bills coming up, the
// latest activity and a row of the tab cards (DEFAULT_WIDGETS in
// server/src/domain/settings.ts). Tests that read a card the owner adds
// themselves, like the summary or top merchants, show it on this page only,
// by standing in for the saved layout, so no other test finds it changed.

import type { Page } from '@playwright/test'
import { patchSettings } from './patchSettings'

export interface Widget {
  type: string
  size: 'half' | 'wide' | 'full'
}

/**
 * Every card Home can show, at the size each reads best at. The tab cards
 * show both in their row and on their own, which the layout tools never
 * offer together, so the layout guard sees every card kind.
 */
export const EVERY_WIDGET: Widget[] = [
  { type: 'leeway', size: 'wide' },
  { type: 'alerts', size: 'full' },
  { type: 'account-list', size: 'wide' },
  { type: 'coming-up', size: 'half' },
  { type: 'latest-activity', size: 'half' },
  { type: 'tab-row', size: 'full' },
  { type: 'cash-flow', size: 'half' },
  { type: 'pace', size: 'half' },
  { type: 'goals', size: 'half' },
  { type: 'net-worth', size: 'half' },
  { type: 'summary', size: 'full' },
  { type: 'trends', size: 'half' },
  { type: 'merchants', size: 'half' },
  { type: 'debts', size: 'half' },
]

/**
 * Shows these cards on Home, after the ones already there, for this
 * page only: the saved layout is untouched, so nothing needs putting back.
 */
export async function showWidgets(page: Page, types: string[]): Promise<void> {
  await patchSettings(page, (settings) => {
    const shown = (settings.dashboard as { widgets: { type: string }[] }).widgets
    const added = EVERY_WIDGET.filter(
      (widget) => types.includes(widget.type) && !shown.some((one) => one.type === widget.type),
    ).map((widget) => ({ ...widget, visible: true }))
    return { ...settings, dashboard: { widgets: [...shown, ...added] } }
  })
}

/** Shows every card Home can show. */
export async function showEveryWidget(page: Page): Promise<void> {
  await showWidgets(
    page,
    EVERY_WIDGET.map((widget) => widget.type),
  )
}
