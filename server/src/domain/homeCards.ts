// The kinds of card Home can show, and how a saved layout naming a kind
// since removed still loads. Leeway and Heads up are always first and fixed;
// the rest are each tab's summary card and a few optional shortcuts to pages
// a tap deeper. web/src/widgets/library.ts draws them.

export const WIDGETS = [
  'leeway',
  'alerts',
  'cash-flow',
  'pace',
  'goals',
  'net-worth',
  'summary',
  'merchants',
  'trends',
  'debts',
] as const

/** Whether a stored card names a kind this build has. */
const knownWidget = (widget: unknown) =>
  (WIDGETS as readonly unknown[]).includes((widget as { type?: unknown } | null)?.type)

/**
 * The stored settings with any card kind since removed left out of Home's
 * layout, so a layout saved with one still loads with every other card in its
 * place, instead of falling back to the default layout. Saving one is still
 * refused (settings.ts keeps its schema strict).
 */
export function withoutRemovedWidgets(data: unknown): unknown {
  const dashboard = (data as { dashboard?: { widgets?: unknown } } | null)?.dashboard
  if (!Array.isArray(dashboard?.widgets)) return data
  const widgets = dashboard.widgets.filter(knownWidget)
  return { ...(data as object), dashboard: { ...dashboard, widgets } }
}
