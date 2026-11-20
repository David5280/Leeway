import { describe, expect, it } from 'vitest'
import type { AccountAlert, AlertKind } from '../src/domain/accountAlerts.js'
import type { BudgetSummary } from '../src/domain/budget.js'
import type { CashFlow } from '../src/domain/cashFlow.js'
import { settingsSchema } from '../src/domain/settings.js'
import { widgetSummary, type WidgetSources } from '../src/domain/widget.js'

// The summary is cut from what the domain functions return. These tests hand
// it those results directly, to reach each rule without seeding a database.

const NOW = new Date('2026-11-17T18:00:00Z')

function budget(totals: Partial<BudgetSummary['totals']>, daysLeft = 12): BudgetSummary {
  return {
    period: { daysLeft },
    totals: { budgetedCents: 0, leftCents: 0, leewayCents: 0, safePerDayCents: 0, ...totals },
  } as BudgetSummary
}

function alert(kind: AlertKind): AccountAlert {
  return { kind, count: kind === 'overdraft_fee' ? 3 : 1 } as AccountAlert
}

function sources(overrides: Partial<WidgetSources> = {}): WidgetSources {
  return {
    now: NOW,
    settings: settingsSchema.parse({}),
    budget: budget({}),
    cashFlow: null,
    netWorth: { assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, history: [] },
    bills: [],
    alerts: [],
    ...overrides,
  }
}

describe('widgetSummary', () => {
  it('leads with safe to spend a day while something is left, counting today', () => {
    const summary = widgetSummary(
      sources({
        budget: budget({ budgetedCents: 90_000, leewayCents: 40_000, safePerDayCents: 3_000 }, 12),
      }),
    )
    expect(summary.headline).toEqual({
      kind: 'leeway',
      cents: 40_000,
      perDayCents: 3_000,
      daysLeft: 13,
    })
  })

  it('gives no amount a day once the budgets are spent or over', () => {
    for (const leewayCents of [0, -5_000]) {
      const summary = widgetSummary(
        sources({ budget: budget({ budgetedCents: 90_000, leewayCents, safePerDayCents: 0 }) }),
      )
      expect(summary.headline).toMatchObject({
        kind: 'leeway',
        cents: leewayCents,
        perDayCents: null,
      })
    }
  })

  it('falls back to cash until payday with no budgets, or to the budget when that is missing', () => {
    const cashFlow = {
      leftAfterBillsCents: -1_200,
      perDayCents: 0,
      nextPayday: '2026-11-28',
    } as CashFlow
    expect(widgetSummary(sources({ cashFlow })).headline).toEqual({
      kind: 'until_payday',
      cents: -1_200,
      perDayCents: 0,
      payday: '2026-11-28',
    })
    expect(widgetSummary(sources()).headline.kind).toBe('leeway')
    expect(widgetSummary(sources()).budgetLeftCents).toBeNull()
  })

  it('measures the net worth change from the start of the window', () => {
    const netWorth = {
      assetsCents: 0,
      liabilitiesCents: 0,
      netWorthCents: 500_000,
      history: [
        { date: '2026-10-18', netWorthCents: 420_000, assetsCents: 420_000, liabilitiesCents: 0 },
        { date: '2026-11-17', netWorthCents: 500_000, assetsCents: 500_000, liabilitiesCents: 0 },
      ],
    }
    expect(widgetSummary(sources({ netWorth })).netWorth).toEqual({
      cents: 500_000,
      changeCents: 80_000,
      sinceDays: 30,
    })
    // No history yet: no change to report.
    expect(widgetSummary(sources()).netWorth.changeCents).toBe(0)
  })

  it('counts balance alerts only, urgent ones apart, and leaves fees out', () => {
    const alerts = (
      ['overdrawn', 'over_limit', 'low_balance', 'low_balance', 'overdraft_fee'] as const
    ).map(alert)
    expect(widgetSummary(sources({ alerts })).alerts).toEqual({ count: 4, urgent: 2 })
  })
})
