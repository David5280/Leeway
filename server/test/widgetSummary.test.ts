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
    daysUntilPayday: 11,
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
        budget: budget({ budgetedCents: 90_000, leewayCents: 40_000, safePerDayCents: 3_076 }, 12),
      }),
    )
    // $400 over the 13 days left, counting today, as the Overview's hero reads it.
    expect(summary.headline).toEqual({
      kind: 'leeway',
      cents: 40_000,
      perDayCents: 3_076,
      daysLeft: 13,
      shortfallCents: 0,
      payday: '2026-11-28',
      paydayEstimate: false,
    })
  })

  it('carries a cash shortfall beside an overspent budget, as the hero says both', () => {
    const cashFlow = cash({ safeCents: 0, shortfallCents: 12_000, perDayCents: 0 })
    const summary = widgetSummary(
      sources({
        budget: budget({ budgetedCents: 90_000, leewayCents: -5_000 }, 12, cashFlow),
        cashFlow,
      }),
    )
    expect(summary.headline).toEqual({
      kind: 'leeway',
      cents: -5_000,
      perDayCents: null,
      daysLeft: 13,
      shortfallCents: 12_000,
      payday: '2026-11-28',
      paydayEstimate: false,
    })
  })

  it("gives the hero's money a day when payday comes before the period ends", () => {
    // $300 safe over 2 days is $150 a day, but the $1,000 budget over 13 days allows $76.
    const cashFlow = cash({ safeCents: 30_000, daysUntilPayday: 2, perDayCents: 15_000 })
    const summary = widgetSummary(
      sources({
        budget: budget({ budgetedCents: 300_000, leewayCents: 100_000 }, 12, cashFlow),
        cashFlow,
      }),
    )
    expect(summary.headline).toMatchObject({
      kind: 'until_payday',
      cents: 30_000,
      perDayCents: 7_692,
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
      cashKnown: true,
      shortfallCents: 0,
      perDayCents: 1_618,
      payday: '2026-11-28',
      paydayEstimate: false,
    })
  })

  it('shows $0 in a shortfall, as the hero does, with the shortfall apart', () => {
    const cashFlow = cash({ safeCents: 0, shortfallCents: 1_200, perDayCents: 0 })
    expect(widgetSummary(sources({ budget: budget({}, 12, cashFlow), cashFlow })).headline).toEqual(
      {
        kind: 'until_payday',
        cents: 0,
        cashKnown: true,
        shortfallCents: 1_200,
        perDayCents: 0,
        payday: '2026-11-28',
        paydayEstimate: false,
      },
    )
    expect(widgetSummary(sources()).headline.kind).toBe('until_payday')
    expect(widgetSummary(sources()).budgetLeftCents).toBeNull()
  })

  it('says the cash is unknown with no checking balance and no budget, never $0 to spend', () => {
    // A card-only owner: no checking account, nothing budgeted.
    const cashFlow = cash({ cashKnown: false, safeCents: 0, perDayCents: 0 })
    const room = budget({}, 12, cashFlow).spendable
    expect(room).toMatchObject({ limitedBy: 'none', leadCents: 0, cashKnown: false })
    const summary = widgetSummary(sources({ budget: budget({}, 12, cashFlow), cashFlow }))
    expect(summary.headline).toMatchObject({ kind: 'until_payday', cashKnown: false })
    expect(summary.budgetLeftCents).toBeNull()
  })

  it('leads with the budget with no checking balance, the cash not judged', () => {
    const cashFlow = cash({ cashKnown: false, safeCents: 0, perDayCents: 0 })
    const summary = widgetSummary(
      sources({
        budget: budget({ budgetedCents: 300_000, leewayCents: 120_000 }, 12, cashFlow),
        cashFlow,
      }),
    )
    expect(summary.headline).toMatchObject({ kind: 'leeway', cents: 120_000 })
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
