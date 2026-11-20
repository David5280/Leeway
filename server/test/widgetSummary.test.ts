import { describe, expect, it } from 'vitest'
import type { AccountAlert, AlertKind } from '../src/domain/accountAlerts.js'
import type { BudgetSummary } from '../src/domain/budget.js'
import { withRoom } from '../src/domain/budgetRoom.js'
import type { CashFlow } from '../src/domain/cashFlow.js'
import { settingsSchema } from '../src/domain/settings.js'
import { widgetSummary, type WidgetSources } from '../src/domain/widget.js'

// The summary is cut from what the domain functions return. These tests hand
// it those results directly, to reach each rule without seeding a database.

const NOW = new Date('2026-11-17T18:00:00Z')

const SETTINGS = settingsSchema.parse({})

/** Cash until payday: plenty unless a test says otherwise. */
function cash(fields: Partial<CashFlow> = {}): CashFlow {
  return {
    nextPayday: '2026-11-28',
    cashKnown: true,
    paydaySource: 'detected_income',
    paydayEstimate: false,
    safeCents: 1_000_000,
    shortfallCents: 0,
    overdraftCents: 0,
    perDayCents: 100_000,
    ...fields,
  } as CashFlow
}

function budget(
  totals: Partial<BudgetSummary['totals']>,
  daysLeft = 12,
  cashFlow: CashFlow = cash(),
) {
  const summary = {
    period: { daysLeft, offset: 0 },
    totals: { budgetedCents: 0, leftCents: 0, leewayCents: 0, safePerDayCents: 0, ...totals },
  } as BudgetSummary
  return withRoom(summary, cashFlow, SETTINGS)
}

function alert(kind: AlertKind): AccountAlert {
  return { kind, count: kind === 'overdraft_fee' ? 3 : 1 } as AccountAlert
}

function sources(overrides: Partial<WidgetSources> = {}): WidgetSources {
  return {
    now: NOW,
    settings: SETTINGS,
    budget: budget({}),
    cashFlow: cash(),
    netWorth: {
      assetsCents: 0,
      liabilitiesCents: 0,
      netWorthCents: 0,
      history: [],
      historyStart: null,
      estimatedBefore: null,
    },
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

  it('leads with safe to spend when checking holds less than the budgets have left', () => {
    const cashFlow = cash({ safeCents: 17_800, perDayCents: 1_618 })
    const summary = widgetSummary(
      sources({
        budget: budget({ budgetedCents: 300_000, leewayCents: 140_400 }, 12, cashFlow),
        cashFlow,
      }),
    )
    expect(summary.headline).toEqual({
      kind: 'until_payday',
      cents: 17_800,
      perDayCents: 1_618,
      payday: '2026-11-28',
    })
  })

  it('shows a shortfall as a negative amount, and falls back to cash with no budgets', () => {
    const cashFlow = cash({ safeCents: 0, shortfallCents: 1_200, perDayCents: 0 })
    expect(widgetSummary(sources({ budget: budget({}, 12, cashFlow), cashFlow })).headline).toEqual(
      { kind: 'until_payday', cents: -1_200, perDayCents: 0, payday: '2026-11-28' },
    )
    expect(widgetSummary(sources()).headline.kind).toBe('until_payday')
    expect(widgetSummary(sources()).budgetLeftCents).toBeNull()
  })

  it('measures the net worth change from the start of the window', () => {
    const netWorth = {
      assetsCents: 0,
      liabilitiesCents: 0,
      netWorthCents: 500_000,
      historyStart: null,
      estimatedBefore: null,
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
