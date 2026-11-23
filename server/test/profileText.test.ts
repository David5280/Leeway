import { describe, expect, it } from 'vitest'
import type { Category } from '../src/domain/categories.js'
import { DIGEST_GOALS, nearestGoals, profileDigest } from '../src/domain/profile/digest.js'
import {
  SPENDING_LEAST_DAYS,
  SPENDING_MAX_DAYS,
  SPENDING_MIN_DAYS,
  spendingWindow,
} from '../src/domain/profile/income.js'
import { addDays } from '../src/lib/dates.js'
import { averageEssentials, wholeMonthsBefore } from '../src/domain/monthlyEssentials.js'
import { emergencyFund } from '../src/domain/savings/emergency.js'
import { RATE_GUARD_FOR_AI, savingsRate } from '../src/domain/savings/rate.js'
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

describe('typical spending window', () => {
  it('runs from the current job, kept between eight weeks and three months', () => {
    // Eight weeks and about three months, pinned as days: a changed constant fails here.
    expect([SPENDING_MIN_DAYS, SPENDING_MAX_DAYS]).toEqual([56, 91])
    // A job that started a week ago still looks back eight weeks.
    expect(spendingWindow(TODAY, '2026-11-12', '2025-01-01')).toEqual({
      start: addDays(TODAY, -56),
      days: 56,
    })
    // So does one that started 40 days ago.
    expect(spendingWindow(TODAY, addDays(TODAY, -40), '2025-01-01')!.days).toBe(56)
    // One that started 70 days ago looks back to its first paycheck.
    expect(spendingWindow(TODAY, addDays(TODAY, -70), '2025-01-01')).toEqual({
      start: addDays(TODAY, -70),
      days: 70,
    })
    // No job, or an old one, looks back three months.
    expect(spendingWindow(TODAY, null, '2025-01-01')).toEqual({
      start: addDays(TODAY, -SPENDING_MAX_DAYS),
      days: SPENDING_MAX_DAYS,
    })
    expect(spendingWindow(TODAY, '2025-03-01', '2025-01-01')!.days).toBe(SPENDING_MAX_DAYS)
  })

  it('starts no earlier than the history, and needs four weeks of it', () => {
    expect(spendingWindow(TODAY, null, '2026-10-01')).toEqual({ start: '2026-10-01', days: 49 })
    expect(spendingWindow(TODAY, null, addDays(TODAY, -SPENDING_LEAST_DAYS))!.days).toBe(28)
    expect(spendingWindow(TODAY, null, addDays(TODAY, -27))).toBeNull()
    expect(spendingWindow(TODAY, null, null)).toBeNull()
  })
})

describe('a typical month of essentials', () => {
  const category = (id: string, kind: Category['kind'], name: string) =>
    ({ id, kind, name, providerCategories: [] }) as unknown as Category
  const categories = [
    category('rent', 'expense', 'Rent'),
    category('fun', 'expense', 'Fun'),
    category('pay', 'income', 'Paycheck'),
  ]
  /** A month of $2,000 rent, `fun` of fun, $10 unfiled and `pay` of pay, nothing coded essential. */
  const month = (fun: number, pay: number) => ({
    totals: [
      { categoryId: 'rent', amountCents: 200_000, count: 1 },
      { categoryId: 'fun', amountCents: fun, count: 1 },
      { categoryId: 'pay', amountCents: -pay, count: 1 },
      { categoryId: null, amountCents: 1_000, count: 1 },
    ],
    essentialCoded: [],
    spentCents: 200_000 + fun + 1_000,
  })

  it('takes the last three whole months that history fully covers, for the fund', () => {
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

  it('averages the essentials over whole months, and knows nothing without one', () => {
    const months = [month(50_000, 600_000), month(30_001, 600_000)]
    expect(averageEssentials(categories, months, ['rent'])).toBe(200_000)
    // Rent and Fun picked, the unfiled $10 left out: (250,000 + 230,001) / 2, rounded.
    expect(averageEssentials(categories, months, ['rent', 'fun'])).toBe(240_001)
    expect(averageEssentials(categories, [], null)).toBeNull()
  })
})

describe('profileDigest', () => {
  it('says only that nothing is known yet for a new install', () => {
    expect(profileDigest(emptyProfile(), dollars)).toBe(
      [
        'Financial profile as of 2026-11-19. Amounts in USD.',
        'Not known yet: pay schedule, a typical month of spending, take-home pay (no paychecks from a current employer), savings rate.',
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
        estimate: false,
        employer: 'Acme Payroll',
        employers: [
          {
            name: 'Acme Payroll',
            cadence: 'biweek',
            typicalPayCents: 240_000,
            monthlyCents: 520_000,
            since: '2026-06-05',
            nextPayday: '2026-12-04',
            estimate: false,
          },
        ],
        since: '2026-06-05',
      },
      monthly: {
        incomeCents: 520_000,
        incomeEstimated: false,
        spendingCents: 410_000,
        essentialSpendingCents: 300_000,
        spendingSince: '2026-08-20',
        spendingDays: 91,
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
          balanceAsOf: null,
        },
      ],
      userContext: ['I am saving for a sailboat.'],
    })
    const digest = profileDigest(profile, dollars)
    expect(digest.split('\n')).toEqual([
      'Financial profile as of 2026-11-19. Amounts in USD.',
      'Pay: every 2 weeks from Acme Payroll since Jun 5, about $2,400 each, next on Dec 4.',
      'Typical month (spending since Aug 20, pay from paychecks only): $5,200 take-home pay in from the current employer, $4,100 spent.',
      'Bills: 9 tracked bills, $2,150 a month.',
      'Accounts: Checking $3,000 (1 account); Credit cards $1,200 owed (2 accounts, 1 without a usable balance).',
      'Saved and invested: $58,000 (savings $8,000, retirement $50,000), up $1,200 since Nov 1. Balance history starts Nov 19, 2026.',
      'Emergency fund: savings cover 2.6 months of essentials ($3,000 a month); target 6 months ($18,000), $10,000 to go, reached around July 2028 at the recent pace.',
      `Savings rate seen at the bank: about 10% of take-home pay ($500 of $5,200 a month: transfers to savings $500). ${RATE_GUARD_FOR_AI}`,
      'Goals: Japan trip 40% ($3,000 to go by Jun 1, on track).',
      'The owner says: I am saving for a sailboat.',
      // A retirement account with no birth year: projections wait for one.
      'Not known yet: birth year, for retirement projections.',
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
        typicalPayCents: 250_000,
        nextPayday: '2026-12-01',
        estimate: true,
        employer: 'Acme Payroll',
        employers: [
          {
            name: 'Acme Payroll',
            cadence: 'month',
            typicalPayCents: 250_000,
            monthlyCents: 250_000,
            since: '2026-11-14',
            nextPayday: '2026-12-01',
            estimate: true,
          },
        ],
        since: '2026-11-14',
      },
      monthly: {
        incomeCents: 500_000,
        incomeEstimated: true,
        spendingCents: 300_000,
        essentialSpendingCents: 300_000,
        spendingSince: '2026-09-24',
        spendingDays: 56,
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
          balanceAsOf: null,
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
          balanceAsOf: null,
        },
      ],
    })
    expect(profileDigest(profile, dollars).split('\n').slice(1, 6)).toEqual([
      'Pay: monthly from Acme Payroll since Nov 14, about $2,500 each, next on Dec 1. This is an estimate until more paychecks confirm how often pay comes.',
      'Typical month (spending since Sep 24, pay from paychecks only): $5,000 take-home pay in from the current employer (estimated until more paychecks confirm it), $3,000 spent.',
      'Saved and invested: $3,000 (savings $3,000), down $200 since Nov 1.',
      'Emergency fund: savings cover 1 month of essentials ($3,000 a month); target 1 month ($3,000), met.',
      // The dated goal comes first: it is the nearer one.
      'Goals: Car 20% ($800 to go by Mar 1, behind pace); Bike 5% ($950 to go).',
    ])
  })

  const employer = (name: string, cadence: 'semimonth' | 'biweek', cents: number) => ({
    name,
    cadence,
    typicalPayCents: cents,
    monthlyCents: cadence === 'semimonth' ? cents * 2 : 130_446,
    since: '2026-09-25',
    nextPayday: '2026-11-20',
    estimate: false,
  })

  it('names each employer paying now, and adds their pay up', () => {
    const profile = emptyProfile({
      pay: {
        cadence: 'semimonth',
        source: 'detected_income',
        typicalPayCents: 200_000,
        nextPayday: '2026-11-20',
        estimate: false,
        employer: 'Initech Payroll',
        employers: [
          employer('Initech Payroll', 'semimonth', 200_000),
          employer('Bluth Co Payroll', 'biweek', 60_000),
        ],
        since: '2026-09-25',
      },
      monthly: {
        incomeCents: 530_446,
        incomeEstimated: false,
        spendingCents: 300_000,
        essentialSpendingCents: 300_000,
        spendingSince: '2026-09-25',
        spendingDays: 55,
      },
    })
    const lines = profileDigest(profile, dollars).split('\n')
    expect(lines).toContain(
      'Pay: from 2 employers: Initech Payroll twice a month since Sep 25, about $2,000 each; Bluth Co Payroll every 2 weeks since Sep 25, about $600 each. Next payday Nov 20.',
    )
    expect(lines).toContain(
      'Typical month (spending since Sep 25, pay from paychecks only): $5,304 take-home pay in from the 2 current employers, $3,000 spent.',
    )
  })

  it('never names an employer the bank does not name as a business', () => {
    const unnamed = (cadence: 'semimonth' | 'biweek', cents: number) => ({
      ...employer('', cadence, cents),
      name: null,
    })
    const profile = emptyProfile({
      pay: {
        cadence: 'semimonth',
        source: 'detected_income',
        typicalPayCents: 200_000,
        nextPayday: '2026-11-20',
        estimate: false,
        employer: null,
        employers: [unnamed('semimonth', 200_000), unnamed('biweek', 60_000)],
        since: '2026-09-25',
      },
    })
    expect(profileDigest(profile, dollars).split('\n')).toContain(
      'Pay: from 2 employers: the main employer twice a month since Sep 25, about $2,000 each; another employer every 2 weeks since Sep 25, about $600 each. Next payday Nov 20.',
    )
  })

  it("calls pay from several employers an estimate while a side job's cadence is a guess", () => {
    // The main job is confirmed, so its payday is not a guess; the side job's amount is.
    const profile = emptyProfile({
      pay: {
        cadence: 'semimonth',
        source: 'detected_income',
        typicalPayCents: 200_000,
        nextPayday: '2026-11-30',
        estimate: false,
        employer: 'Initech Payroll',
        employers: [
          employer('Initech Payroll', 'semimonth', 200_000),
          { ...employer('Bluth Co Payroll', 'biweek', 60_000), estimate: true },
        ],
        since: '2026-09-25',
      },
    })
    expect(profileDigest(profile, dollars).split('\n')).toContain(
      'Pay: from 2 employers: Initech Payroll twice a month since Sep 25, about $2,000 each; Bluth Co Payroll every 2 weeks since Sep 25, about $600 each. Next payday Nov 30. This is an estimate until more paychecks confirm how often each employer pays.',
    )
  })

  it('never prints pay it did not see, and lists it and the emergency fund as not known', () => {
    const profile = emptyProfile({
      pay: {
        cadence: 'month',
        source: 'pay_period',
        typicalPayCents: null,
        nextPayday: null,
        estimate: false,
        employer: null,
        employers: [],
        since: null,
      },
      monthly: {
        incomeCents: null,
        incomeEstimated: false,
        spendingCents: 300_000,
        essentialSpendingCents: 300_000,
        spendingSince: '2026-08-20',
        spendingDays: 91,
      },
      savings: savingsReport([kindReport('savings', 300_000)], { historyStartsOn: null }),
      emergencyFund: null,
    })
    const digest = profileDigest(profile, dollars)
    expect(digest).toContain(
      'Typical month (spending since Aug 20, pay from paychecks only): $3,000 spent.',
    )
    expect(digest).not.toMatch(/\$0 take-home/)
    expect(digest.split('\n').at(-1)).toBe(
      'Not known yet: take-home pay (no paychecks from a current employer), emergency fund, savings rate.',
    )
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

    it('puts open goals before stale and reached ones, and dated before undated', () => {
      const order = nearestGoals([
        profileGoal({ id: 'reached', targetDate: '2026-12-01', status: 'reached' }),
        profileGoal({ id: 'stale', targetDate: '2026-11-01', status: 'stale' }),
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
        'stale',
        'reached',
      ])
    })

    it('words a goal on an account no longer shared as of that day, with nothing to go', () => {
      const stale = profileGoal({
        name: 'House',
        percent: 80,
        remainingCents: 50_000,
        targetDate: '2027-03-01',
        status: 'stale',
        balanceAsOf: '2026-11-10',
      })
      expect(goalsLine([stale])).toBe(
        'Goals: House 80% as of Nov 10, its account is no longer shared.',
      )
    })
  })
})
