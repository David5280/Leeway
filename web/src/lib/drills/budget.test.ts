import { describe, expect, it } from 'vitest'
import type { Budget, Connection, SpendingPace } from '../../api/client'
import { budgetFor, category, transaction } from '../../test/fake'
import { mathSentence } from '../drill'
import { money as formatMoney } from '../money'
import { inAndOut, recentDrill } from './activity'
import {
  budgetDetail,
  categoriesDrill,
  incomeDrill,
  leewayDrill,
  spendingTrend,
  spendingUsual,
  spentDrill,
  uncategorizedDrill,
  usualPeriodSpend,
} from './budget'
import { paceDrill, syncDrill } from './pace'

/** Whole dollars, as the app shows amounts in drill-downs. */
const money = (cents: number) => formatMoney(cents, { currency: 'USD', locale: 'en-US' })
const said = (budget: { math: Parameters<typeof mathSentence>[0] }) =>
  mathSentence(budget.math, money)

const groceries = category('Groceries', { budgetCents: 60000 })
const dining = category('Dining out', { budgetCents: 20000 })
const fun = category('Fun')
const paycheck = category('Paycheck', { kind: 'income' })
const categories = [groceries, dining, fun, paycheck]

/** November, day 17 of 30: $200 on groceries, $240 dining, $50 fun, $45 unsorted, $2,500 in. */
const budget: Budget = budgetFor(categories, [
  { categoryId: groceries.id, amountCents: 20000 },
  { categoryId: dining.id, amountCents: 24000 },
  { categoryId: fun.id, amountCents: 5000 },
  { categoryId: null, amountCents: 4500 },
  { categoryId: paycheck.id, amountCents: -250000 },
])

const row = (name: string) => budget.categories.find((one) => one.name === name)!

describe('budgetDetail', () => {
  it("words a row's budget: what is left, how far over, or none", () => {
    expect(budgetDetail(row('Groceries'), money)).toBe('$400 left of $600')
    expect(budgetDetail(row('Dining out'), money)).toBe('Over its $200 budget by $40')
    expect(budgetDetail(row('Fun'), money)).toBe('No budget')
  })
})

describe('leewayDrill', () => {
  it('takes what the budgets spent from the budgets, a day at a time', () => {
    const drill = leewayDrill(budget, money)
    expect(said(drill)).toBe(
      'Left to spend $360 = Budgets this period $800 minus spent in them $440',
    )
    expect(drill.figure).toEqual({ cents: 36000, tone: undefined })
    expect(drill.math.note).toMatch(/^That is about \$26 a day for the next 14 days\./)
    // Only categories with a budget are listed; Fun has none.
    expect(drill.items!.rows.map((one) => one.label)).toEqual(['Groceries', 'Dining out'])
  })

  it('says how far over the budgets are, in red', () => {
    const over = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 84000 }])
    const drill = leewayDrill(over, money)
    expect(said(drill)).toBe(
      'Over budget by $40 = Budgets this period $800 minus spent in them $840',
    )
    expect(drill.figure).toEqual({ cents: -4000, tone: 'problem' })
    expect(drill.math.note).toBe('Spending in categories without a budget is not counted here.')
  })

  it('holds back what goals set aside, and gives a safe amount per day', () => {
    const roomy = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }], {
      setAsides: [{ goalId: 'g', name: 'Bike', color: '#E0622D', amountCents: 10000 }],
    })
    const drill = leewayDrill(roomy, money)
    expect(said(drill)).toBe(
      'Left to spend $500 = Budgets this period $800 minus spent in them $200 minus set aside for goals $100',
    )
    expect(drill.math.note).toMatch(/^That is about \$36 a day for the next 14 days\./)
    expect(drill.subtitle).toBe('Day 17 of 30')
  })

  it('says "1 day" on the last day', () => {
    const last = { ...budget, totals: { ...budget.totals, leewayCents: 100, safePerDayCents: 100 } }
    const drill = leewayDrill({ ...last, period: { ...last.period, daysLeft: 0 } }, money)
    expect(drill.math.note).toMatch(/for the next 1 day\./)
  })
})

describe('spentDrill and spendingTrend', () => {
  it('adds budgeted, unbudgeted and unsorted spending, against this point last period', () => {
    const drill = spentDrill(budget, 'month')
    expect(said(drill)).toBe(
      'Spent $535 = Categories with a budget $440 plus categories without one $50 plus not yet sorted $45',
    )
    expect(drill.usual).toEqual(spendingUsual(budget, 'month'))
    expect(drill.usual).toMatchObject({ basis: 'this point last month', subject: 'spent' })
    expect(drill.items!.rows.map((one) => one.label)).toEqual(['Dining out', 'Groceries', 'Fun'])
    expect(drill.trend).toBeUndefined()
  })

  it('leaves the unsorted term out when everything has a category', () => {
    const sorted = budgetFor(categories, [{ categoryId: fun.id, amountCents: 5000 }])
    expect(spentDrill(sorted, 'week').math.terms).toHaveLength(2)
  })

  it('draws spending each period once there are two', () => {
    const periods = [
      { start: '2026-10-01', spentCents: 90000 },
      { start: '2026-11-01', spentCents: 53500 },
    ] as Parameters<typeof spendingTrend>[0]
    expect(spendingTrend(periods, 'month')).toEqual({
      points: [
        { date: '2026-10-01', cents: 90000 },
        { date: '2026-11-01', cents: 53500 },
      ],
      label: 'Spending each month',
      description: 'What went out in each of the last 2 months, this one so far last.',
    })
    expect(spendingTrend(periods!.slice(0, 1), 'month')).toBeUndefined()
    expect(spendingTrend(undefined, 'month')).toBeUndefined()
  })
})

describe('categoriesDrill', () => {
  it('names six categories, sums the rest, and notes what is unsorted', () => {
    const many = Array.from({ length: 8 }, (_, index) => category(`C${index}`))
    const wide = budgetFor(many, [
      ...many.map((one, index) => ({ categoryId: one.id, amountCents: (8 - index) * 1000 })),
      { categoryId: null, amountCents: 700 },
    ])
    const drill = categoriesDrill(wide, 'month', money)
    expect(drill.math.terms).toHaveLength(7)
    expect(drill.math.terms.at(-1)).toEqual({
      label: 'everything else',
      value: { cents: 3000 },
      op: 'plus',
    })
    expect(drill.math.note).toBe('$7 more still needs a category.')
    expect(drill.items!.rows).toHaveLength(8)
  })

  it('has no note when everything is sorted', () => {
    const sorted = budgetFor(categories, [{ categoryId: fun.id, amountCents: 5000 }])
    expect(categoriesDrill(sorted, 'month', money).math.note).toBeUndefined()
  })
})

describe('incomeDrill', () => {
  it('lists each income category, against this point last period', () => {
    const withHistory = {
      ...budget,
      previous: {
        ...budget.previous,
        categories: [{ categoryId: paycheck.id, spentToDateCents: -240000 }],
      },
    } as Budget
    const drill = incomeDrill(withHistory, 'month')
    expect(drill.math.terms).toEqual([
      { label: 'Paycheck', value: { cents: 250000 }, op: undefined },
    ])
    expect(drill.usual).toMatchObject({ currentCents: budget.totals.incomeCents, goodWhen: 'up' })
    expect(drill.items!.rows).toHaveLength(1)
  })

  it('says when nothing has come in yet, with no usual to compare', () => {
    const quiet = budgetFor(categories, [])
    const drill = incomeDrill(quiet, 'week')
    expect(drill.math.terms[0]!.label).toBe('Nothing has come in yet')
    expect(drill.usual).toBeUndefined()
    expect(drill.items).toBeUndefined()
  })
})

describe('uncategorizedDrill', () => {
  it('counts what needs a category and links to sorting it', () => {
    const drill = uncategorizedDrill(budget)
    expect(drill.figure).toEqual({ text: '1 transaction' })
    expect(drill.more).toEqual({
      to: '/transactions?category=uncategorized',
      label: 'Sort 1 transaction',
    })
  })

  it('says everything has a category, with nothing to open', () => {
    const drill = uncategorizedDrill(budgetFor(categories, []))
    expect(drill.figure).toEqual({ text: '0 transactions' })
    expect(drill.math.note).toBe('Everything has a category.')
    expect(drill.more).toBeUndefined()
  })
})

describe('paceDrill', () => {
  const pace = {
    categoryIds: [groceries.id, dining.id],
    budgetCents: 80000,
    cumulative: [{ date: '2026-11-17', cents: 44000 }],
    projectedCents: 96000,
  } as SpendingPace

  it('adds the rest of the period at this rate, warning when it lands over', () => {
    const drill = paceDrill(pace, budget, true)
    expect(said(drill)).toBe(
      'Lands near $960 = Spent so far $440 plus the rest of the period at this rate $520',
    )
    expect(drill.figure).toEqual({ cents: 96000, tone: 'warn' })
    // It is measured against the budget, not a usual month, and says so.
    expect(drill.usual).toMatchObject({ usualCents: 80000, heading: 'Compared with the budget' })
    expect(drill.items!.rows.map((one) => one.label)).toEqual(['Groceries', 'Dining out'])
  })

  it('reports only what was spent in a past period', () => {
    const drill = paceDrill({ ...pace, cumulative: [] }, budget, false)
    expect(said(drill)).toBe('Spent $0 = Spent in the period $0')
    expect(drill.figure.tone).toBeUndefined()
  })
})

describe('syncDrill', () => {
  const connection = (fields: Partial<Connection>) =>
    ({
      id: 'a',
      institutionName: 'Chase',
      status: 'active',
      lastSyncedAt: null,
      accountCount: 1,
      ...fields,
    }) as Connection

  it('counts the banks syncing on their own and those that need the owner', () => {
    const drill = syncDrill(
      [
        connection({ accountCount: 2 }),
        connection({ id: 'b', status: 'needs_reauth', institutionName: null }),
      ],
      () => '5 min ago',
    )
    expect(drill.figure).toEqual({ text: 'Needs you', tone: 'warn' })
    expect(drill.math.result.value).toEqual({ text: '1 bank' })
    expect(drill.math.note).toMatch(/^3 accounts come in/)
    expect(drill.items!.rows.map((one) => [one.label, one.detail])).toEqual([
      ['Chase', 'Synced 5 min ago'],
      ['Bank', 'Needs you to sign in again'],
    ])
  })

  it('reads up to date with one account', () => {
    const drill = syncDrill([connection({})], () => 'never')
    expect(drill.figure).toEqual({ text: 'Up to date', tone: undefined })
    expect(drill.math.note).toMatch(/^1 account comes in/)
  })
})

describe('recentDrill', () => {
  const known = new Map([[groceries.id, groceries]])
  const txs = [
    transaction({
      id: '1',
      date: '2026-11-17',
      name: 'MARKET',
      categoryId: groceries.id,
      amountCents: 8450,
    }),
    transaction({ id: '2', date: '2026-11-16', name: 'PAY', amountCents: -250000 }),
    transaction({
      id: '3',
      date: '2026-11-15',
      name: 'MOVE',
      categoryId: 'cat-transfer',
      amountCents: 50000,
    }),
    transaction({ id: '4', date: '2026-11-14', name: 'HIDDEN', amountCents: 999, excluded: true }),
  ]

  it('adds money out less money in, leaving out transfers and excluded charges', () => {
    expect(inAndOut(txs, (id) => (id === 'cat-transfer' ? 'transfer' : null))).toEqual({
      outCents: 8450,
      inCents: 250000,
    })
    const drill = recentDrill(txs, known)
    expect(drill.figure).toEqual({ text: '4 transactions' })
    expect(drill.math.result.value).toEqual({ cents: 8450 - 250000 })
    // A category the list does not know is a transfer, drawn as one.
    expect(drill.items!.rows[2]!.icon).toEqual({ category: null, transfer: true })
    expect(drill.items!.rows[0]!.icon).toEqual({ category: groceries, transfer: false })
  })

  it('counts one transaction in the singular', () => {
    expect(recentDrill(txs.slice(0, 1), known).figure).toEqual({ text: '1 transaction' })
  })
})

describe('usualPeriodSpend', () => {
  const period = (offset: number, spentCents: number) => ({
    offset,
    start: '2026-10-01',
    end: '2026-10-31',
    days: 31,
    spentCents,
    incomeCents: 0,
    categories: [],
  })

  it('has nothing to say before the trends arrive or a period has finished', () => {
    expect(usualPeriodSpend(undefined)).toBeNull()
    expect(usualPeriodSpend([])).toBeNull()
    expect(usualPeriodSpend([period(0, 50000)])).toBeNull()
    expect(usualPeriodSpend([period(-1, 0), period(0, 50000)])).toBeNull()
  })

  it('averages the finished periods that had spending, to the cent', () => {
    expect(usualPeriodSpend([period(-1, 10001)])).toBe(10001)
    expect(usualPeriodSpend([period(-3, 0), period(-2, 10000), period(-1, 10001)])).toBe(10001)
  })

  it('keeps huge amounts exact', () => {
    const huge = 900_000_000_000
    expect(usualPeriodSpend([period(-2, huge), period(-1, huge)])).toBe(huge)
  })
})
