import { describe, expect, it } from 'vitest'
import { computeBudget } from '../src/domain/budget.js'
import type { Category } from '../src/domain/categories.js'
import { settingsSchema } from '../src/domain/settings.js'
import { periodContaining } from '../src/lib/periods.js'

function category(id: string, fields: Partial<Category> = {}): Category {
  return {
    id,
    name: id,
    color: '#000000',
    icon: null,
    kind: 'expense',
    budgetCents: null,
    budgetCadence: 'month',
    warnAtPercent: null,
    trackPace: true,
    providerCategories: [],
    group: null,
    rollover: false,
    rolloverSince: null,
    position: 0,
    ...fields,
  }
}

// A strict pace margin (5% of the budget) keeps the pace cases below clear-cut.
const settings = settingsSchema.parse({ paceTolerancePercent: 5 })
const period = periodContaining('2026-11-15', { kind: 'monthly', startDay: 1 })

describe('computeBudget', () => {
  // Nov 15 is day 15 of 30, so half the month has passed.
  const summary = computeBudget({
    settings,
    period,
    offset: 0,
    today: '2026-11-15',
    categories: [
      category('groceries', { budgetCents: 60000 }),
      category('dining', { budgetCents: 20000 }),
      category('fun', { budgetCents: 10000 }),
      category('gifts'),
      category('pay', { kind: 'income', budgetCents: 500000 }),
      category('transfers', { kind: 'transfer' }),
    ],
    totals: [
      { categoryId: 'groceries', amountCents: 25000, count: 5 },
      { categoryId: 'dining', amountCents: 24000, count: 6 },
      { categoryId: 'fun', amountCents: 8500, count: 2 },
      { categoryId: 'gifts', amountCents: 3000, count: 1 },
      { categoryId: 'pay', amountCents: -250000, count: 1 },
      { categoryId: null, amountCents: 1500, count: 1 },
    ],
  })
  const row = (id: string) => summary.categories.find((c) => c.categoryId === id)!

  it('reports spending, what is left and status per category', () => {
    expect(row('groceries')).toMatchObject({
      budgetCents: 60000,
      spentCents: 25000,
      leftCents: 35000,
      percentUsed: 42,
      status: 'ok',
      expectedByNowCents: 30000,
      pace: 'under',
      projectedCents: 50000,
    })
    expect(row('dining')).toMatchObject({ status: 'over', leftCents: -4000, pace: 'over' })
    expect(row('fun')).toMatchObject({ status: 'warning', percentUsed: 85 })
    expect(row('gifts')).toMatchObject({ status: 'no_budget', budgetCents: null, leftCents: null })
  })

  it('shows income as money received and leaves transfers out', () => {
    expect(row('pay')).toMatchObject({ kind: 'income', spentCents: 250000 })
    expect(summary.categories.some((c) => c.categoryId === 'transfers')).toBe(false)
    expect(summary.totals.incomeCents).toBe(250000)
  })

  it('totals budgets, all spending and safe to spend per day', () => {
    expect(summary.totals).toMatchObject({
      budgetedCents: 90000,
      budgetedSpentCents: 57500,
      spentCents: 25000 + 24000 + 8500 + 3000 + 1500,
      leftCents: 32500,
      uncategorizedCents: 1500,
      uncategorizedCount: 1,
      // 16 days left counting today: floor(32500 / 16).
      safePerDayCents: 2031,
    })
    expect(summary.period).toMatchObject({
      start: '2026-11-01',
      end: '2026-11-30',
      daysElapsed: 15,
      daysLeft: 15,
    })
  })

  it('projects budgeted spending at the current rate, leaving out unbudgeted spending', () => {
    // Day 15 of 30: each budgeted category doubles; gifts and uncategorized are left out.
    expect(summary.totals.projectedBudgetedCents).toBe(50000 + 48000 + 17000)
    expect(summary.totals.projectedCents).toBe((25000 + 24000 + 8500 + 3000 + 1500) * 2)
  })

  it('projects a fixed category at its budget, since a bill lands once', () => {
    const result = computeBudget({
      settings,
      period,
      offset: 0,
      today: '2026-11-15',
      categories: [
        category('rent', { budgetCents: 150000, trackPace: false }),
        category('utilities', { budgetCents: 10000, trackPace: false }),
      ],
      // Rent is paid; the utility bill has not come yet but costs a little more than planned.
      totals: [
        { categoryId: 'rent', amountCents: 150000, count: 1 },
        { categoryId: 'utilities', amountCents: 12000, count: 1 },
      ],
    })
    expect(result.totals.projectedBudgetedCents).toBe(150000 + 12000)
  })

  it('raises alerts, worst first, with plain messages', () => {
    expect(summary.alerts.map((a) => [a.categoryId, a.level])).toEqual([
      ['dining', 'over'],
      ['fun', 'warning'],
    ])
    expect(summary.alerts[0]!.message).toBe('dining is over budget by $40 ($240 of $200).')
  })

  it('treats a past period as complete', () => {
    const past = computeBudget({
      settings,
      period,
      offset: -1,
      today: '2026-12-10',
      categories: [category('groceries', { budgetCents: 60000 })],
      totals: [{ categoryId: 'groceries', amountCents: 50000, count: 3 }],
    })
    expect(past.period).toMatchObject({ daysElapsed: 30, daysLeft: 0 })
    expect(past.totals.safePerDayCents).toBeNull()
    expect(past.categories[0]).toMatchObject({ projectedCents: 50000, pace: 'under' })
    expect(past.totals.projectedBudgetedCents).toBe(50000)
  })

  it('converts a weekly budget into a monthly period', () => {
    const result = computeBudget({
      settings,
      period,
      offset: 0,
      today: '2026-11-15',
      categories: [category('coffee', { budgetCents: 2500, budgetCadence: 'week' })],
      totals: [],
    })
    expect(result.categories[0]!.budgetCents).toBe(10871)
  })
})

describe('pace settings', () => {
  const base = {
    period,
    offset: 0,
    today: '2026-11-15',
    totals: [{ categoryId: 'rent', amountCents: 150000, count: 1 }],
  }

  it('skips pace for categories that do not track it', () => {
    const summary = computeBudget({
      ...base,
      settings,
      categories: [category('rent', { budgetCents: 160000, trackPace: false })],
    })
    expect(summary.categories[0]).toMatchObject({ pace: null, status: 'warning' })
    expect(summary.alerts.map((a) => a.level)).toEqual(['warning'])
  })

  it('uses the pace sensitivity from settings', () => {
    const groceries = { categoryId: 'groceries', amountCents: 25000, count: 5 }
    const run = (paceTolerancePercent: number) =>
      computeBudget({
        ...base,
        totals: [groceries],
        settings: settingsSchema.parse({ paceTolerancePercent }),
        categories: [category('groceries', { budgetCents: 60000 })],
      }).categories[0]!.pace
    // $250 spent against $300 expected by now on a $600 budget.
    expect(run(5)).toBe('under')
    expect(run(10)).toBe('on')
  })
})

describe('rollover and set-asides', () => {
  const base = { period, offset: 0, today: '2026-11-15', settings }

  it('adds what rolled over to the budget, and leaves other categories alone', () => {
    const summary = computeBudget({
      ...base,
      categories: [
        category('dining', { budgetCents: 10000, rollover: true, rolloverSince: '2026-10-01' }),
        category('fun', { budgetCents: 10000 }),
      ],
      totals: [{ categoryId: 'dining', amountCents: 12000, count: 2 }],
      carries: new Map([['dining', 4000]]),
    })
    expect(summary.categories[0]).toMatchObject({
      rollover: true,
      carriedCents: 4000,
      budgetCents: 14000,
      leftCents: 2000,
      status: 'warning',
    })
    expect(summary.categories[1]).toMatchObject({ rollover: false, carriedCents: null })
    expect(summary.totals.budgetedCents).toBe(24000)
  })

  it('reads a rolled-over overspend as over, with no spending yet and no pace to keep', () => {
    const summary = computeBudget({
      ...base,
      categories: [
        category('dining', { budgetCents: 10000, rollover: true, rolloverSince: '2026-10-01' }),
      ],
      totals: [],
      carries: new Map([['dining', -15000]]),
    })
    expect(summary.categories[0]).toMatchObject({
      budgetCents: -5000,
      percentUsed: 100,
      status: 'over',
      expectedByNowCents: 0,
      pace: 'on',
    })
    expect(summary.alerts[0]!.message).toBe(
      'dining is over budget by $50 (counting $150 overspent in earlier periods).',
    )
  })

  it('holds goal set-asides back from the leeway and the daily figure', () => {
    const setAsides = [
      { goalId: 'bike', name: 'Bike', color: '#5ccf8c', amountCents: 16000 },
      { goalId: 'trip', name: 'Trip', color: '#e5c07b', amountCents: 4000 },
    ]
    const summary = computeBudget({
      ...base,
      categories: [category('groceries', { budgetCents: 60000 })],
      totals: [],
      setAsides,
    })
    // $600 left, $200 held: $400 over the 16 days left, today included.
    expect(summary.setAsides).toEqual(setAsides)
    expect(summary.totals).toMatchObject({
      leftCents: 60000,
      setAsideCents: 20000,
      leewayCents: 40000,
      safePerDayCents: 2500,
    })
  })

  it('never offers a negative daily figure when goals hold more than is left', () => {
    const summary = computeBudget({
      ...base,
      categories: [category('groceries', { budgetCents: 10000 })],
      totals: [],
      setAsides: [{ goalId: 'bike', name: 'Bike', color: '#5ccf8c', amountCents: 30000 }],
    })
    expect(summary.totals).toMatchObject({ leewayCents: -20000, safePerDayCents: 0 })
  })
})
