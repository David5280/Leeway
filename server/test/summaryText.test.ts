import { describe, expect, it } from 'vitest'
import type { Checkin } from '../src/domain/checkin.js'
import { formatCents } from '../src/lib/money.js'
import { summaryFacts } from '../src/domain/summaryFacts.js'
import { MAX_POINTS, plainSummary, type SummaryText } from '../src/domain/summaryText.js'
import { accountAlert, checkin, goal, type CheckinGoal as Goal } from './fixtures/checkin.js'

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
      cashFlow: {
        cashKnown: true,
        cashCents: 250000,
        billsDueCents: 150000,
        safeCents: 100000,
        paydaySource: 'detected_income',
      },
      budget: { previousSpentToDateCents: 70000 },
      goals: [goal('Trip')],
      netWorth: { changeCents: 120000 },
    })
    expect(summarize(busy).points).toEqual([
      '2 things need you today. See Heads up.',
      '$1,000 is safe to spend before payday on Dec 1, after bills.',
      "You've spent $100 more than at this point last month.",
      'Trip is 25% of the way there.',
    ])
    expect(summarize(busy).points).toHaveLength(MAX_POINTS)
  })

  it('warns when bills and an overdraft before payday are more than the cash', () => {
    const short = checkin({
      cashFlow: {
        cashKnown: true,
        cashCents: 50000,
        billsDueCents: 80000,
        overdraftCents: 10000,
        shortfallCents: 40000,
        paydaySource: 'detected_income',
        paydayEstimate: true,
      },
    })
    // The headline says it, so no point repeats it.
    expect(summarize(short)).toEqual({
      headline:
        'Checking may be $400 short of the bills and overdraft before payday, best guess Dec 1.',
      points: [],
    })
  })

  it('keeps the budget headline while it leads, leaving an overdraft to its own alert', () => {
    const cashFlow = {
      cashKnown: true,
      cashCents: 500000,
      overdraftCents: 5000,
      safeCents: 495000,
      paydaySource: 'detected_income' as const,
    }
    const overdrawn = checkin({
      cashFlow,
      spendable: {
        ...cashFlow,
        shortfallCents: 0,
        budgetLeftCents: 120000,
        leadCents: 120000,
        limitedBy: 'budget',
        perDayCents: 8571,
        payday: '2026-12-01',
        paydayEstimate: false,
        // The overdrawn account's alert says what it needs; the budget's figure carries no note.
        note: null,
        problem: false,
      },
    })
    // No cash point either: checking covers the budget, so the cash is no second figure.
    expect(summarize(overdrawn)).toEqual({
      headline: "You're on track: $1,200 left, about $85.71 a day for 15 days.",
      points: [],
    })
  })

  it('says payday is today on payday, and the period end when no payday is known', () => {
    const payday = checkin({
      cashFlow: { cashKnown: true, cashCents: 1000, safeCents: 1000, nextPayday: '2026-11-17' },
    })
    expect(summarize(payday).points).toEqual([
      '$10 is safe to spend until payday today, after bills.',
    ])
    const noPayday = checkin({ cashFlow: { cashKnown: true, cashCents: 1000, safeCents: 1000 } })
    expect(summarize(noPayday).points).toEqual([
      '$10 is safe to spend by Nov 30, when this budget period ends (no payday found yet), after bills.',
    ])
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

describe('an overdrawn account or a card over its limit', () => {
  const overLimit = accountAlert({
    kind: 'over_limit',
    summary: 'Your Capital One credit card is $80.00 over its limit.',
  })

  it('takes the headline, even when the budget is on track', () => {
    const summary = summarize(checkin({ alerts: [accountAlert()] }))
    expect(summary.headline).toBe('Your Chase checking account is overdrawn by $42.10.')
    // The budget still gets its say, as the first point, without "You're on track".
    expect(summary.points).toEqual([
      'Your budgets are on track: $1,200 left, about $85.71 a day for 15 days.',
    ])
  })

  it('leads with a card over its limit the same way', () => {
    expect(summarize(checkin({ alerts: [overLimit] })).headline).toBe(overLimit.summary)
  })

  it('counts the other alerts first, then says how the budget is going', () => {
    const lowAlert = accountAlert({ kind: 'low_balance', severity: 'warning' })
    const over = checkin({
      alerts: [accountAlert(), overLimit, lowAlert],
      budget: { projectedBudgetedCents: 230000 },
    })
    expect(summarize(over).points).toEqual([
      '2 more account alerts are in Heads up on the dashboard.',
      "At this pace you'd finish the month $300 over budget.",
    ])
  })

  it('leaves the headline to the budget for a warning such as a fee or a low balance', () => {
    const fee = accountAlert({
      kind: 'overdraft_fee',
      severity: 'warning',
      summary: 'Your Chase checking account was charged an overdraft fee of $35.00.',
    })
    const summary = summarize(checkin({ alerts: [fee] }))
    expect(summary.headline).toMatch(/^You're on track/)
    expect(summary.points[0]).toBe(fee.summary)
  })
})

describe('the account alert point', () => {
  const lowAlert = accountAlert({
    kind: 'low_balance',
    severity: 'warning',
    summary: 'Your Chase savings account is down to $35.00.',
  })
  const accountItem = {
    priority: 'now' as const,
    topic: 'account' as const,
    message: 'Everyday is overdrawn by $42.10.',
    tool: 'list_alerts',
  }

  const feeAlert = accountAlert({
    kind: 'overdraft_fee',
    severity: 'warning',
    summary: 'Your Chase checking account was charged an overdraft fee of $35.00.',
  })

  it('leads with the worst alert, without naming the account', () => {
    const points = summarize(checkin({ alerts: [feeAlert], attention: [accountItem] })).points
    // The alert is its own point, so it is not counted again as a thing needing you today.
    expect(points).toEqual([feeAlert.summary])
  })

  it('counts the other alerts after the worst one', () => {
    const one = summarize(checkin({ alerts: [feeAlert, lowAlert] })).points[0]
    expect(one).toBe(`${feeAlert.summary} 1 more account alert is in Heads up on the dashboard.`)
    const two = summarize(checkin({ alerts: [feeAlert, lowAlert, lowAlert] })).points[0]
    expect(two).toContain('2 more account alerts are in Heads up on the dashboard.')
  })
})

describe('summaryFacts', () => {
  it('gives an AI account alerts without account names', () => {
    const facts = summaryFacts(
      checkin({
        alerts: [accountAlert()],
        attention: [
          {
            priority: 'now',
            topic: 'account',
            message: 'Everyday is overdrawn by $42.10.',
            tool: 'list_alerts',
          },
        ],
      }),
      monthly,
      money,
    )
    expect(facts.headsUp).toEqual([])
    expect(facts.accountAlerts).toEqual(['Your Chase checking account is overdrawn by $42.10.'])
    expect(facts.fixedHeadline).toBe('Your Chase checking account is overdrawn by $42.10.')
    expect(JSON.stringify(facts)).not.toContain('Everyday')
  })

  it('gives an AI formatted amounts and dates, and no accounts or transactions', () => {
    const facts = summaryFacts(
      checkin({
        attention: [
          { priority: 'soon', topic: 'bill', message: 'Rent is due', tool: 'list_bills' },
        ],
        cashFlow: {
          cashKnown: true,
          cashCents: 30000,
          billsDueCents: 12200,
          safeCents: 17800,
          perDayCents: 1271,
          paydaySource: 'detected_income',
        },
        spendable: {
          safeCents: 17800,
          shortfallCents: 0,
          overdraftCents: 0,
          budgetLeftCents: 120000,
          leadCents: 17800,
          limitedBy: 'cash',
          perDayCents: 1271,
          cashKnown: true,
          payday: '2026-12-01',
          paydaySource: 'detected_income',
          paydayEstimate: false,
          note: null,
          problem: false,
        },
        pay: {
          monthlyCents: 420000,
          estimate: true,
          cadence: 'semimonth',
          paycheckCents: 210000,
          since: '2026-11-13',
        },
      }),
      monthly,
      money,
    )
    expect(facts).toMatchObject({
      today: 'Nov 17',
      period: { kind: 'month', ends: 'Nov 30', left: '$1,200', budgetRoomAfterGoals: '$1,200' },
      // The one figure for what can be spent, with the line that says why it is less than the budget.
      spendNow: {
        amount: '$178',
        perDay: '$12.71',
        limitedBy: 'cash',
        meaning: 'safe to spend from checking before payday on Dec 1, after bills',
        checkingBalanceKnown: true,
        note: 'Your budget has $1,200 left, but you have $178 you can safely spend before payday on Dec 1.',
      },
      // The cash behind it, as detail.
      cashInChecking: {
        safeToSpendBeforePayday: '$178',
        payday: 'Dec 1',
        paydayIsAnEstimate: false,
        noPaydayFoundSoPeriodEndUsed: false,
        cashInChecking: '$300',
        billsDueByPayday: '$122',
        overdraftToBringBackToZero: '$0',
        shortfall: null,
      },
      typicalMonthlyPay: { amount: '$4,200', estimated: true },
      headsUp: [{ priority: 'soon', message: 'Rent is due' }],
      debts: null,
      fixedHeadline: null,
      netWorthChangeLast30Days: '$0',
    })
    expect(JSON.stringify(facts)).not.toContain('list_bills')
    // Without a checking balance or a budget there is no figure to quote.
    expect(summaryFacts(checkin(), monthly, money)).toMatchObject({
      spendNow: null,
      cashInChecking: null,
    })
  })

  it('gives an AI the budget as the figure to quote while the budget leads, the cash as detail', () => {
    const facts = summaryFacts(
      checkin({
        budget: { leewayCents: 50000, safePerDayCents: 3571 },
        cashFlow: { cashKnown: true, cashCents: 200000, safeCents: 200000, perDayCents: 14285 },
        spendable: {
          safeCents: 200000,
          shortfallCents: 0,
          overdraftCents: 0,
          budgetLeftCents: 50000,
          leadCents: 50000,
          limitedBy: 'budget',
          perDayCents: 3571,
          cashKnown: true,
          payday: '2026-12-01',
          paydaySource: 'period_end',
          paydayEstimate: false,
          note: null,
          problem: false,
        },
      }),
      monthly,
      money,
    )
    expect(facts.spendNow).toEqual({
      amount: '$500',
      perDay: '$35.71',
      limitedBy: 'budget',
      meaning: 'left in the budgets after goals, which checking covers',
      checkingBalanceKnown: true,
      note: null,
    })
    expect(facts.cashInChecking?.safeToSpendBeforePayday).toBe('$2,000')
  })

  it('gives an AI savings at a glance, with unknowns left null rather than zero', () => {
    const savings = {
      hasSavingsAccounts: true,
      totalCents: 5_800_000,
      changeThisMonthCents: -12_000,
      changeSince: '2026-11-05',
      emergencyFundMonths: 2.5,
      emergencyFundTargetMonths: 6,
      // Known, but never handed to the summary writer (see the next test).
      bankSeenSavingsRatePercent: 4,
      payrollIncludedSavingsRatePercent: null,
      savingsRateNote: null,
      pension: null,
    }
    expect(summaryFacts(checkin({ savings }), monthly, money).savingsAndInvestments).toEqual({
      total: '$58,000',
      changeThisMonth: '-$120',
      changeMeasuredSince: 'Nov 5',
      emergencyFundMonthsCovered: 2.5,
      emergencyFundTargetMonths: 6,
    })
    const unmoved = { ...savings, changeThisMonthCents: null, changeSince: null }
    expect(
      summaryFacts(checkin({ savings: unmoved }), monthly, money).savingsAndInvestments,
    ).toMatchObject({
      changeThisMonth: null,
      changeMeasuredSince: null,
    })
    expect(summaryFacts(checkin(), monthly, money).savingsAndInvestments).toBeNull()
    // With only a pension there is no balance to speak of.
    const pensionOnly = { ...savings, hasSavingsAccounts: false, totalCents: 0 }
    expect(
      summaryFacts(checkin({ savings: pensionOnly }), monthly, money).savingsAndInvestments,
    ).toBeNull()
  })

  it('never gives the summary writer a savings rate it could call too low', () => {
    const savings = {
      totalCents: 5_800_000,
      changeThisMonthCents: null,
      changeSince: null,
      emergencyFundMonths: null,
      emergencyFundTargetMonths: null,
      bankSeenSavingsRatePercent: 4,
      hasSavingsAccounts: true,
      payrollIncludedSavingsRatePercent: 12,
      savingsRateNote: 'Counts your pension contributions as well as transfers your bank shows.',
      pension: { count: 1, monthlyContributionCents: 42_300, employerMonthlyCents: 82_283 },
    }
    const facts = JSON.stringify(summaryFacts(checkin({ savings }), monthly, money))
    expect(facts).not.toMatch(/savingsRate|ofPay|pension/i)
  })
})
