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
import { checkin, goal, type CheckinGoal as Goal } from './fixtures/checkin.js'

const money = (cents: number) => formatCents(cents)
const monthly = { period: { kind: 'monthly' as const, startDay: 1 }, locale: 'en-US' }

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

  it('takes out what is set aside for goals', () => {
    const held = checkin({ budget: { setAsideCents: 20000, leewayCents: 100000 } })
    expect(summarize(held).headline).toBe(
      "You're on track: $1,000 left after $200 set aside for goals, about $85.71 a day for 15 days.",
    )
  })

  it('says when spending has dipped into what is set aside for goals', () => {
    const dipped = checkin({
      budget: { leftCents: 5000, setAsideCents: 20000, leewayCents: -15000 },
    })
    expect(summarize(dipped).headline).toBe(
      'Spending has dipped $150 into what you set aside for goals.',
    )
  })

  it('warns when the pace would end the period over budget', () => {
    expect(summarize(checkin({ budget: { projectedBudgetedCents: 230000 } })).headline).toBe(
      "At this pace you'd finish the month $300 over budget.",
    )
  })

  it('ignores spending outside the budgets when judging the pace', () => {
    // A fee or an unbudgeted purchase pushes all spending up, not the budgets.
    const fees = checkin({ budget: { projectedCents: 230000, projectedBudgetedCents: 190000 } })
    expect(summarize(fees).headline).toMatch(/^You're on track/)
  })

  it('says how far over when the budget is already spent', () => {
    const over = checkin({
      budget: { leftCents: -4500, projectedBudgetedCents: 250000, daysLeft: 3 },
    })
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
    const busy = checkin({ budget: { projectedBudgetedCents: 230000 } })
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
      goals: [goal('Trip')],
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

  it('names a late goal, then a behind one, then one ready to buy, then the closest to done', () => {
    const late = goal('Trip', { status: 'past_due', percent: 10 })
    const behind = goal('Bike', { onTrack: false, targetDate: '2027-04-30' })
    const ready = goal('Couch', { kind: 'purchase', status: 'reached', percent: 100 })
    const closest = goal('Fund', { percent: 90 })
    const pointFor = (goals: Goal[]) => summarize(checkin({ goals })).points

    expect(pointFor([closest, ready, behind, late])).toEqual([
      'Trip passed its date with $100 still to go.',
    ])
    expect(pointFor([closest, ready, behind])).toEqual(['Bike is behind pace for Apr 30.'])
    expect(pointFor([closest, ready])).toEqual(['Couch is fully saved and ready to buy.'])
    expect(pointFor([goal('Bike', { percent: 40 }), closest])).toEqual([
      'Fund is 90% of the way there.',
    ])
    // A reached savings goal, or a behind one with no date, is not worth a line.
    expect(pointFor([goal('Done', { status: 'reached' })])).toEqual([])
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
