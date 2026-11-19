import { describe, expect, it } from 'vitest'
import type { Category } from '../src/domain/categories.js'
import { DIGEST_GOALS, nearestGoals, profileDigest } from '../src/domain/profile/digest.js'
import {
  averageMonths,
  essentialSpending,
  wholeMonthsBefore,
} from '../src/domain/profile/income.js'
import { emergencyFund } from '../src/domain/savings/emergency.js'
import { savingsRate } from '../src/domain/savings/rate.js'
import {
  dollars,
  emptyProfile,
  kindReport,
  profileGoal,
  savingsReport,
} from './fixtures/profile.js'

const TODAY = '2026-11-19'

describe('emergencyFund', () => {
  const fund = (fields: Partial<Parameters<typeof emergencyFund>[0]> = {}) =>
    emergencyFund({
      savedCents: 600_000,
      monthlyEssentialsCents: 300_000,
      essentialsFrom: 'spending',
      targetMonths: 6,
      monthlyPaceCents: 50_000,
      today: TODAY,
      ...fields,
    })

  it('counts months covered against the target, and when the pace gets there', () => {
    expect(fund()).toEqual({
      savedCents: 600_000,
      monthlyEssentialsCents: 300_000,
      essentialsFrom: 'spending',
      monthsCovered: 2,
      targetMonths: 6,
      targetCents: 1_800_000,
      shortCents: 1_200_000,
      status: 'low',
      monthlyPaceCents: 50_000,
      // 24 months at $500 closes a $12,000 gap.
      reachesTargetOn: '2028-11-01',
    })
  })

  it('rounds months down, so it never claims more cover than there is', () => {
    expect(fund({ savedCents: 899_999 })!.monthsCovered).toBe(2.9)
    expect(fund({ savedCents: 900_000 })).toMatchObject({ monthsCovered: 3, status: 'building' })
  })

  it('calls the target met at or above it, with no forecast', () => {
    expect(fund({ savedCents: 1_800_000 })).toMatchObject({
      status: 'met',
      shortCents: 0,
      reachesTargetOn: null,
    })
  })

  it('gives no forecast without a pace, or when it would take more than 50 years', () => {
    expect(fund({ monthlyPaceCents: null })!.reachesTargetOn).toBeNull()
    expect(fund({ monthlyPaceCents: 0 })!.reachesTargetOn).toBeNull()
    expect(fund({ monthlyPaceCents: 1 })!.reachesTargetOn).toBeNull()
  })

  it('treats an overdrawn savings balance as nothing saved', () => {
    expect(fund({ savedCents: -5_000 })).toMatchObject({ savedCents: 0, monthsCovered: 0 })
  })

  it('is unknown without essential spending to cover', () => {
    expect(fund({ monthlyEssentialsCents: null })).toBeNull()
    expect(fund({ monthlyEssentialsCents: 0 })).toBeNull()
  })
})

describe('savingsRate', () => {
  it('divides what is saved by pay, adding back anything saved before the paycheck', () => {
    expect(
      savingsRate(500_000, [
        { label: 'Transfers to savings', monthlyCents: 50_000, beforePaycheck: false },
        { label: 'Pension', monthlyCents: 40_000, beforePaycheck: true },
      ]),
    ).toEqual({
      percent: 17,
      savedMonthlyCents: 90_000,
      payMonthlyCents: 540_000,
      sources: [
        { label: 'Transfers to savings', monthlyCents: 50_000, beforePaycheck: false },
        { label: 'Pension', monthlyCents: 40_000, beforePaycheck: true },
      ],
    })
  })

  it('is unknown without pay or without any saving seen, never zero', () => {
    const source = { label: 'Transfers', monthlyCents: 10_000, beforePaycheck: false }
    expect(savingsRate(null, [source])).toBeNull()
    expect(savingsRate(0, [source])).toBeNull()
    expect(savingsRate(500_000, [])).toBeNull()
    expect(savingsRate(500_000, [{ ...source, monthlyCents: 0 }])).toBeNull()
  })
})

describe('monthly averages', () => {
  const category = (id: string, kind: Category['kind']) => ({ id, kind }) as Category
  const categories = [
    category('rent', 'expense'),
    category('fun', 'expense'),
    category('pay', 'income'),
  ]

  it('takes the last three whole months that history fully covers', () => {
    expect(wholeMonthsBefore(TODAY, '2026-01-01')).toEqual([
      { start: '2026-08-01', end: '2026-09-01' },
      { start: '2026-09-01', end: '2026-10-01' },
      { start: '2026-10-01', end: '2026-11-01' },
    ])
    // History from Sep 12 leaves October as the only whole month.
    expect(wholeMonthsBefore(TODAY, '2026-09-12')).toEqual([
      { start: '2026-10-01', end: '2026-11-01' },
    ])
    expect(wholeMonthsBefore(TODAY, '2026-11-02')).toEqual([])
    expect(wholeMonthsBefore(TODAY, null)).toEqual([])
  })

  it('averages income, spending and essentials over the months', () => {
    const month = (rent: number, fun: number, pay: number) => [
      { categoryId: 'rent', amountCents: rent, count: 1 },
      { categoryId: 'fun', amountCents: fun, count: 1 },
      { categoryId: 'pay', amountCents: -pay, count: 1 },
      { categoryId: null, amountCents: 1_000, count: 1 },
    ]
    const totals = [month(200_000, 50_000, 600_000), month(200_000, 30_001, 600_000)]
    expect(averageMonths(categories, totals, ['rent'])).toEqual({
      months: 2,
      incomeCents: 600_000,
      spendingCents: 241_001,
      essentialSpendingCents: 200_000,
    })
    // With no essentials picked, all spending counts, uncategorized included.
    expect(essentialSpending(categories, totals[0]!, null)).toBe(251_000)
    // An income category picked as essential is not spending.
    expect(essentialSpending(categories, totals[0]!, ['pay', 'gone'])).toBe(0)
  })

  it('knows nothing without a whole month', () => {
    expect(averageMonths(categories, [], null)).toEqual({
      months: 0,
      incomeCents: null,
      spendingCents: null,
      essentialSpendingCents: null,
    })
  })
})

describe('profileDigest', () => {
  it('says only that nothing is known yet for a new install', () => {
    expect(profileDigest(emptyProfile(), dollars)).toBe(
      [
        'Financial profile as of 2026-11-19. Amounts in USD.',
        'Not known yet: pay schedule, a typical month of income and spending, savings rate.',
      ].join('\n'),
    )
  })

  it('lists every fact in plain words, with no account names or numbers', () => {
    const profile = emptyProfile({
      pay: {
        cadence: 'biweek',
        source: 'detected_income',
        typicalPayCents: 240_000,
        nextPayday: '2026-12-04',
      },
      monthly: {
        months: 3,
        incomeCents: 520_000,
        spendingCents: 410_000,
        essentialSpendingCents: 300_000,
      },
      bills: { count: 9, monthlyCents: 215_000 },
      accounts: [
        { kind: 'checking', label: 'Checking', accounts: 1, totalCents: 300_000, notCounted: 0 },
        {
          kind: 'credit_card',
          label: 'Credit cards',
          accounts: 2,
          totalCents: 120_000,
          notCounted: 1,
        },
      ],
      savings: savingsReport(
        [kindReport('savings', 800_000), kindReport('retirement', 5_000_000)],
        {
          changes: {
            month: { changeCents: 120_000, since: '2026-11-01', accountsLeftOut: 0 },
            days30: null,
            year: null,
            all: null,
          },
        },
      ),
      emergencyFund: emergencyFund({
        savedCents: 800_000,
        monthlyEssentialsCents: 300_000,
        essentialsFrom: 'spending',
        targetMonths: 6,
        monthlyPaceCents: 50_000,
        today: TODAY,
      }),
      savingsRate: savingsRate(520_000, [
        { label: 'Transfers to savings', monthlyCents: 50_000, beforePaycheck: false },
      ]),
      goals: [
        {
          id: 'g',
          name: 'Japan trip',
          kind: 'savings',
          accountKind: null,
          percent: 40,
          currentCents: 200_000,
          targetCents: 500_000,
          remainingCents: 300_000,
          targetDate: '2027-06-01',
          projectedDate: null,
          onTrack: true,
          status: 'in_progress',
        },
      ],
      userContext: ['I am saving for a sailboat.'],
    })
    const digest = profileDigest(profile, dollars)
    expect(digest.split('\n')).toEqual([
      'Financial profile as of 2026-11-19. Amounts in USD.',
      'Pay: every 2 weeks, about $2,400 each, next on Dec 4.',
      'Typical month (last 3 whole months): $5,200 take-home pay in, $4,100 spent, $3,000 of it essential.',
      'Bills: 9 tracked bills, $2,150 a month.',
      'Accounts: Checking $3,000 (1 account); Credit cards $1,200 owed (2 accounts, 1 without a usable balance).',
      'Saved and invested: $58,000 (savings $8,000, retirement $50,000), up $1,200 since Nov 1. Balance history starts Nov 19.',
      'Emergency fund: savings cover 2.6 months of essentials ($3,000 a month); target 6 months ($18,000), $10,000 to go, reached around July 2028 at the recent pace.',
      'Savings rate: about 10% of pay ($500 of $5,200 a month: transfers to savings $500). Payroll deductions, such as a pension or a 401(k), are not counted.',
      'Goals: Japan trip 40% ($3,000 to go by Jun 1, on track).',
      'The owner says: I am saving for a sailboat.',
    ])
    // A few hundred tokens at most: well under 2,000 characters.
    expect(digest.length).toBeLessThan(2000)
    expect(digest).not.toMatch(/Test Bank|0001|acct-/)
  })

  it('leaves out what it does not know and words a fall, a met target and an undated goal', () => {
    const fund = emergencyFund({
      savedCents: 300_000,
      monthlyEssentialsCents: 300_000,
      essentialsFrom: 'bills',
      targetMonths: 1,
      monthlyPaceCents: null,
      today: TODAY,
    })
    const profile = emptyProfile({
      pay: {
        cadence: 'month',
        source: 'pay_period',
        typicalPayCents: null,
        nextPayday: '2026-12-01',
      },
      monthly: {
        months: 1,
        incomeCents: 500_000,
        spendingCents: 300_000,
        essentialSpendingCents: 300_000,
      },
      savings: savingsReport([kindReport('savings', 300_000)], {
        historyStartsOn: null,
        changes: {
          month: { changeCents: -20_000, since: '2026-11-01', accountsLeftOut: 0 },
          days30: null,
          year: null,
          all: null,
        },
      }),
      emergencyFund: fund,
      goals: [
        {
          id: 'g',
          name: 'Bike',
          kind: 'purchase',
          accountKind: null,
          percent: 5,
          currentCents: 5_000,
          targetCents: 100_000,
          remainingCents: 95_000,
          targetDate: null,
          projectedDate: null,
          onTrack: null,
          status: 'in_progress',
        },
        {
          id: 'h',
          name: 'Car',
          kind: 'savings',
          accountKind: null,
          percent: 20,
          currentCents: 20_000,
          targetCents: 100_000,
          remainingCents: 80_000,
          targetDate: '2027-03-01',
          projectedDate: '2027-09-01',
          onTrack: false,
          status: 'in_progress',
        },
      ],
    })
    expect(profileDigest(profile, dollars).split('\n').slice(1, 6)).toEqual([
      'Pay: monthly, next on Dec 1.',
      'Typical month (last 1 whole month): $5,000 take-home pay in, $3,000 spent.',
      'Saved and invested: $3,000 (savings $3,000), down $200 since Nov 1.',
      'Emergency fund: savings cover 1 month of essentials ($3,000 a month); target 1 month ($3,000), met.',
      // The dated goal comes first: it is the nearer one.
      'Goals: Car 20% ($800 to go by Mar 1, behind pace); Bike 5% ($950 to go).',
    ])
  })

  describe('goals', () => {
    /** Goals due a month apart from January, each with a name this long. */
    const dueMonthly = (count: number, name = (n: number) => `Goal ${n}`) =>
      Array.from({ length: count }, (_, i) =>
        profileGoal({
          id: `g${i}`,
          name: name(i + 1),
          targetDate: `2027-${String((i % 12) + 1).padStart(2, '0')}-01`,
        }),
      )
    const goalsLine = (goals: ReturnType<typeof profileGoal>[]) =>
      profileDigest(emptyProfile({ goals }), dollars)
        .split('\n')
        .find((line) => line.startsWith('Goals:'))

    it('names every goal up to the cap', () => {
      expect(DIGEST_GOALS).toBe(5)
      expect(goalsLine(dueMonthly(5))).toBe(
        'Goals: Goal 1 40% ($3,000 to go by Jan 1); Goal 2 40% ($3,000 to go by Feb 1); ' +
          'Goal 3 40% ($3,000 to go by Mar 1); Goal 4 40% ($3,000 to go by Apr 1); ' +
          'Goal 5 40% ($3,000 to go by May 1).',
      )
    })

    it('names the nearest five past the cap and counts the rest', () => {
      // Listed latest first, to show the digest picks by date, not by order given.
      const line = goalsLine(dueMonthly(6).reverse())
      expect(line).toMatch(/^Goals: Goal 1 .*Goal 5 40% \(\$3,000 to go by May 1\); and 1 more\.$/)
      expect(line).not.toContain('Goal 6')
    })

    it('stays under 2,000 characters however many long-named goals there are', () => {
      const goals = dueMonthly(40, (n) => `${'A very long goal name '.repeat(3)}${n}`)
      const digest = profileDigest(emptyProfile({ goals }), dollars)
      expect(digest).toContain('; and 35 more.')
      expect(digest.length).toBeLessThan(2000)
    })

    it('puts open goals before reached ones, and dated before undated', () => {
      const order = nearestGoals([
        profileGoal({ id: 'reached', targetDate: '2026-12-01', status: 'reached' }),
        profileGoal({ id: 'undated' }),
        profileGoal({ id: 'later', targetDate: '2027-06-01' }),
        profileGoal({ id: 'past', targetDate: '2026-10-01', status: 'past_due' }),
        profileGoal({ id: 'also undated' }),
      ])
      expect(order.map((goal) => goal.id)).toEqual([
        'past',
        'later',
        'undated',
        'also undated',
        'reached',
      ])
    })
  })
})
