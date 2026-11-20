// The Overview opens with only what answers "am I OK?" (DEFAULT_WIDGETS in
// server/src/domain/settings.ts). Tests that read a widget the owner adds
// themselves, like the summary or the recent list, show it on this page only,
// by standing in for the saved layout, so no other test finds it changed.

import type { Page } from '@playwright/test'
import { patchSettings } from './patchSettings'

export interface Widget {
  type: string
  size: 'half' | 'wide' | 'full'
}

/** Every widget the library offers, at the size each reads best at. */
export const EVERY_WIDGET: Widget[] = [
  { type: 'leeway', size: 'wide' },
  { type: 'net-worth', size: 'half' },
  { type: 'alerts', size: 'full' },
  { type: 'flows', size: 'full' },
  { type: 'pace', size: 'full' },
  { type: 'summary', size: 'full' },
  { type: 'glance', size: 'full' },
  { type: 'categories', size: 'wide' },
  { type: 'accounts', size: 'half' },
  { type: 'recent', size: 'wide' },
  { type: 'merchants', size: 'half' },
  { type: 'bills', size: 'half' },
  { type: 'cash-flow', size: 'full' },
  { type: 'goals', size: 'half' },
  { type: 'debts', size: 'half' },
  { type: 'trends', size: 'full' },
]

/**
 * Shows these widgets on the Overview, after the ones already there, for this
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

/** Shows every widget the library offers, as an owner who added them all would see it. */
export async function showEveryWidget(page: Page): Promise<void> {
  await showWidgets(
    page,
    EVERY_WIDGET.map((widget) => widget.type),
  )
}
