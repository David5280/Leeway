import { describe, expect, it } from 'vitest'
import type { Checkin } from '../src/domain/checkin.js'
import { formatCents } from '../src/lib/money.js'
import {
  MAX_POINTS,
  plainSummary,
  shortDate,
  summaryFacts,
  type SummaryText,
} from '../src/domain/summaryText.js'

const money = (cents: number) => formatCents(cents)
const monthly = { period: { kind: 'monthly' as const, startDay: 1 }, locale: 'en-US' }

/** A quiet mid-month: on budget, cash to spare, nothing to flag, nothing to compare. */
function checkin(change: Partial<{ [K in keyof Checkin]: Partial<Checkin[K]> }> = {}): Checkin {
  const base: Checkin = {
    today: '2026-11-17',
    attention: [],
    budget: {
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      daysLeft: 14,
      budgetedCents: 200000,
      spentCents: 80000,
      leftCents: 120000,
      safePerDayCents: 8571,
      projectedCents: 160000,
      incomeCents: 300000,
      previousSpentToDateCents: 0,
    },
    cashFlow: {
      cashCents: 0,
      nextPayday: '2026-12-01',
      paydaySource: 'period_end',
      billsDueCents: 0,
      leftAfterBillsCents: 0,
      perDayCents: 0,
    },
    bills: { count: 0, monthlyCents: 0 },
    goals: [],
    debts: null,
    netWorth: { netWorthCents: 0, changeCents: 0, sinceDays: 30 },
  }
  return {
    ...base,
    ...change,
    budget: { ...base.budget, ...change.budget },
    cashFlow: { ...base.cashFlow, ...change.cashFlow },
    netWorth: { ...base.netWorth, ...change.netWorth },
  } as Checkin
}

const summarize = (c: Checkin): SummaryText => plainSummary(c, monthly, money)

describe('the headline', () => {
  it('says how much is left and how much a day when on track', () => {
    expect(summarize(checkin()).headline).toBe(
      "You're on track: $1,200 left, about $85.71 a day for 15 days.",
    )
  })

  it('leaves out the daily amount when there is none', () => {
    const headline = summarize(checkin({ budget: { safePerDayCents: null, daysLeft: 0 } })).headline
    expect(headline).toBe("You're on track: $1,200 left for 1 day.")
  })

  it('warns when the pace would end the period over budget', () => {
    expect(summarize(checkin({ budget: { projectedCents: 230000 } })).headline).toBe(
      "At this pace you'd finish the month $300 over budget.",
    )
  })

  it('says how far over when the budget is already spent', () => {
    const over = checkin({ budget: { leftCents: -4500, projectedCents: 250000, daysLeft: 3 } })
    expect(summarize(over).headline).toBe("You're $45 over budget with 4 days to go.")
  })

  it('asks for budgets when there are none', () => {
    const unbudgeted = checkin({ budget: { budgetedCents: 0, leftCents: 0, spentCents: 4200 } })
    expect(summarize(unbudgeted).headline).toBe(
      "You've spent $42 this month. Set budgets to see what's left.",
    )
  })

  it('names the paycheck or the week as the period', () => {
    const weekly = { period: { kind: 'weekly' as const, weekStartsOn: 1 }, locale: 'en-US' }
    const busy = checkin({ budget: { projectedCents: 230000 } })
    expect(plainSummary(busy, weekly, money).headline).toContain('finish the week')
  })
})

describe('the points', () => {
  it('has none on a quiet day with nothing to compare', () => {
    expect(summarize(checkin()).points).toEqual([])
  })

  it('leads with what needs the owner today, then cash, pace, goals and net worth', () => {
    const busy = checkin({
      attention: [
        { priority: 'now', topic: 'bank', message: 'A bank needs a login', tool: 'x' },
        { priority: 'now', topic: 'bill', message: 'A bill looks unpaid', tool: 'x' },
        { priority: 'fyi', topic: 'cleanup', message: 'Some need a category', tool: 'x' },
      ],
      cashFlow: { cashCents: 250000, billsDueCents: 150000, leftAfterBillsCents: 100000 },
      budget: { previousSpentToDateCents: 70000 },
      goals: [
        {
          name: 'Trip',
          percent: 25,
          remainingCents: 75000,
          monthlyNeededCents: 12500,
          status: 'in_progress',
        },
      ],
      netWorth: { changeCents: 120000 },
    })
    expect(summarize(busy).points).toEqual([
      '2 things need you today. See Heads up below.',
      '$1,000 is free until payday on Dec 1, after bills.',
      "You've spent $100 more than at this point last month.",
      'Trip is 25% of the way there.',
    ])
    expect(summarize(busy).points).toHaveLength(MAX_POINTS)
  })

  it('warns when bills before payday are more than the cash', () => {
    const short = checkin({
      cashFlow: { cashCents: 50000, billsDueCents: 80000, leftAfterBillsCents: -30000 },
    })
    expect(summarize(short).points).toEqual([
      'Bills before payday on Dec 1 come to $800, $300 more than your cash.',
    ])
  })

  it('says payday is today on payday', () => {
    const payday = checkin({
      cashFlow: { cashCents: 1000, leftAfterBillsCents: 1000, nextPayday: '2026-11-17' },
    })
    expect(summarize(payday).points).toEqual(['$10 is free until payday today, after bills.'])
  })

  it('says when spending is lower than last period, and when net worth fell', () => {
    const calmer = checkin({
      budget: { previousSpentToDateCents: 95000 },
      netWorth: { changeCents: -5000 },
    })
    expect(summarize(calmer).points).toEqual([
      "You've spent $150 less than at this point last month.",
      'Net worth is down $50 over the last 30 days.',
    ])
  })

  it('names a late goal before the one closest to done', () => {
    const goal = (name: string, percent: number, status: Checkin['goals'][number]['status']) => ({
      name,
      percent,
      remainingCents: 10000,
      monthlyNeededCents: null,
      status,
    })
    const goals = checkin({
      goals: [goal('Bike', 40, 'in_progress'), goal('Couch', 90, 'in_progress')],
    })
    expect(summarize(goals).points).toEqual(['Couch is 90% of the way there.'])
    const late = checkin({
      goals: [goal('Couch', 90, 'in_progress'), goal('Trip', 10, 'past_due')],
    })
    expect(summarize(late).points).toEqual(['Trip passed its date with $100 still to go.'])
  })
})

describe('summaryFacts', () => {
  it('gives an AI formatted amounts and dates, and no accounts or transactions', () => {
    const facts = summaryFacts(
      checkin({
        attention: [
          { priority: 'soon', topic: 'bill', message: 'Rent is due', tool: 'list_bills' },
        ],
      }),
      monthly,
      money,
    )
    expect(facts).toMatchObject({
      today: 'Nov 17',
      period: { kind: 'month', ends: 'Nov 30', left: '$1,200', safeToSpendPerDay: '$85.71' },
      untilPayday: { payday: 'Dec 1' },
      headsUp: [{ priority: 'soon', message: 'Rent is due' }],
      debts: null,
      netWorthChangeLast30Days: '$0',
    })
    expect(JSON.stringify(facts)).not.toContain('list_bills')
  })
})

describe('shortDate', () => {
  it('keeps the calendar day in any language', () => {
    expect(shortDate('2026-01-01', 'en-US')).toBe('Jan 1')
    expect(shortDate('2026-01-01', 'de-DE')).toBe('1. Jan.')
  })
})
