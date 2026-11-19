// A widget summary as GET /api/widget returns it, typed by the server's own
// definition, for the Scriptable script's tests and the widget previews.

import type { WidgetSummary } from '../../../server/src/domain/widget'

/** A household mid-period: some leeway left, three bills coming, one low account. */
export function widgetSummary(overrides: Partial<WidgetSummary> = {}): WidgetSummary {
  return {
    version: 1,
    asOf: '2026-11-17T18:05:00.000Z',
    currency: 'USD',
    locale: 'en-US',
    appearance: { theme: 'night', mode: 'theme' },
    headline: { kind: 'leeway', cents: 84_250, perDayCents: 6_480, daysLeft: 13 },
    budgetLeftCents: 112_000,
    netWorth: { cents: 4_812_300, changeCents: 120_000, sinceDays: 30 },
    nextBills: [
      { name: 'Rent', dueDate: '2026-11-20', overdue: false },
      { name: 'Phone', dueDate: '2026-11-24', overdue: false },
      { name: 'Car insurance', dueDate: '2026-12-01', overdue: false },
    ],
    alerts: { count: 1, urgent: 0 },
    ...overrides,
  }
}

/** The same household having a hard month: over budget, a bill overdue, an account overdrawn. */
export function troubledWidgetSummary(): WidgetSummary {
  return widgetSummary({
    headline: { kind: 'leeway', cents: -5_000, perDayCents: null, daysLeft: 13 },
    budgetLeftCents: -5_000,
    netWorth: { cents: 4_712_300, changeCents: -30_000, sinceDays: 30 },
    nextBills: [
      { name: 'Phone', dueDate: '2026-11-10', overdue: true },
      { name: 'Rent', dueDate: '2026-11-20', overdue: false },
    ],
    alerts: { count: 2, urgent: 1 },
  })
}
