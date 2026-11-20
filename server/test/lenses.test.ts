import { describe, expect, it } from 'vitest'
import { monthYear, savingsInsights } from '../src/domain/profile/insights.js'
import { signedMoney } from '../src/domain/profile/lens.js'
import type { ProfileGoal } from '../src/domain/profile/profile.js'
import { goalLens, savingsView } from '../src/domain/profile/views.js'
import { emergencyFund } from '../src/domain/savings/emergency.js'
import { savingsRate } from '../src/domain/savings/rate.js'
import { dollars, emptyProfile, kindReport, savingsReport } from './fixtures/profile.js'

const TODAY = '2026-11-19'
const format = { money: dollars, locale: 'en-US' }

const fund = emergencyFund({
  savedCents: 600_000,
  monthlyEssentialsCents: 300_000,
  essentialsFrom: 'spending',
  targetMonths: 6,
  monthlyPaceCents: 50_000,
  today: TODAY,
})!

/** Saving $500 a month from $6,000 of pay, all of it sent to investments. */
const contributions = {
  since: '2025-11-20',
  totalCents: { cash: 0, invested: 600_000 },
  monthlyCents: { cash: 0, invested: 50_000 },
  transferCount: 12,
}
const rate = savingsRate(600_000, [
  { label: 'Transfers', monthlyCents: 50_000, beforePaycheck: false },
])

function goal(name: string, fields: Partial<ProfileGoal> = {}): ProfileGoal {
  return {
    id: name,
    name,
    kind: 'savings',
    accountKind: null,
    percent: 10,
    currentCents: 100,
    targetCents: 1_000,
    remainingCents: 900,
    targetDate: null,
    projectedDate: null,
    onTrack: null,
    status: 'in_progress',
    balanceAsOf: null,
    ...fields,
  }
}

/** A change over the last year, or over all history when it is younger than that. */
const yearChange = (changeCents: number, since = '2025-11-19') => ({
  month: null,
  days30: null,
  year: { changeCents, since, accountsLeftOut: 0 },
  all: null,
})

describe('savingsInsights', () => {
  it('says nothing for someone with no savings', () => {
    expect(savingsInsights(emptyProfile(), format)).toEqual([])
  })

  it('words the emergency fund with the owner numbers and a forecast', () => {
    const profile = emptyProfile({
      savings: savingsReport([kindReport('savings', 600_000)]),
      emergencyFund: fund,
    })
    expect(savingsInsights(profile, format)).toEqual([
      {
        about: 'savings',
        topic: 'emergency_coverage',
        tone: 'attention',
        text: 'Your savings of $6,000 cover 2 months of $3,000 a month of essential spending. Your target of 6 months is $18,000, $12,000 to go.',
      },
      {
        about: 'savings',
        topic: 'emergency_pace',
        tone: 'neutral',
        text: 'At about $500 a month into savings, you reach 6 months of expenses in November 2028.',
      },
    ])
  })

  it('says when the target is met, measured against bills when spending is too new', () => {
    const met = {
      ...fund,
      monthsCovered: 6.5,
      status: 'met' as const,
      essentialsFrom: 'bills' as const,
    }
    const [insight] = savingsInsights(
      emptyProfile({
        savings: savingsReport([kindReport('savings', 600_000)]),
        emergencyFund: met,
      }),
      format,
    )
    expect(insight).toEqual({
      about: 'savings',
      topic: 'emergency_coverage',
      tone: 'good',
      text: 'Your savings of $6,000 cover 6.5 months of $3,000 a month in bills, meeting your 6 months emergency fund target.',
    })
  })

  it('asks for a month of history before counting months covered', () => {
    const profile = emptyProfile({ savings: savingsReport([kindReport('savings', 1)]) })
    expect(savingsInsights(profile, format)[0]).toMatchObject({
      topic: 'emergency_unknown',
      text: expect.stringMatching(/^Once Leeway has a whole month/),
    })
  })

  it('words the savings rate, contributions and how each kind moved', () => {
    const retirement = kindReport('retirement', 5_000_000, { changes: yearChange(-120_000) })
    const investing = kindReport('investment', 1_000_000, {
      changes: {
        month: null,
        days30: null,
        year: null,
        all: { changeCents: 25_000, since: '2026-11-02', accountsLeftOut: 0 },
      },
    })
    const profile = emptyProfile({
      savings: savingsReport([retirement, investing], { contributions }),
      savingsRate: rate,
    })
    expect(savingsInsights(profile, format).map((i) => [i.about, i.topic, i.text])).toEqual([
      [
        'overall',
        'savings_rate',
        'About 8% of your take-home pay goes to savings through your bank: $500 a month of $6,000. Counts transfers your bank shows. Money taken from pay, like a pension or a 401(k), counts once you add it under Retirement.',
      ],
      [
        'overall',
        'contributions',
        'Since Nov 20 you moved $6,000 from your bank into investment and retirement accounts.',
      ],
      [
        'retirement',
        'change',
        'Retirement is down $1,200 since Nov 19, counting deposits and market moves together.',
      ],
      [
        'investment',
        'change',
        'Investing is up $250 since Nov 2, counting deposits and market moves together.',
      ],
    ])
  })

  it('cites the open goal due soonest, with where its recent pace lands it', () => {
    const profile = emptyProfile({ savings: savingsReport([kindReport('savings', 100)]) })
    const goals = [
      goal('House', { targetDate: '2029-11-01', percent: 56, remainingCents: 1_760_000 }),
      goal('Lisbon', {
        targetDate: '2027-06-01',
        percent: 62,
        remainingCents: 114_000,
        projectedDate: '2027-04-10',
        onTrack: true,
      }),
      goal('Done', { targetDate: '2026-12-01', status: 'reached' }),
      goal('Someday'),
    ]
    const [, insight] = savingsInsights(profile, format, () => goals)
    expect(insight).toEqual({
      about: 'savings',
      topic: 'goal',
      tone: 'good',
      text: 'Lisbon is 62% there, $1,140 to go by June 2027. At the recent pace it gets there in April 2027.',
    })
    const [, slow] = savingsInsights(profile, format, () => [goals[0]!])
    expect(slow!.text).toBe('House is 56% there, $17,600 to go by November 2029.')
    // A goal behind its date is told as a fact, not as an alarm.
    const late = { ...goals[0]!, projectedDate: '2030-05-01', onTrack: false }
    const [, behind] = savingsInsights(profile, format, () => [late])
    expect(behind).toMatchObject({
      tone: 'neutral',
      text: 'House is 56% there, $17,600 to go by November 2029. At the recent pace it gets there in May 2030.',
    })
  })

  it('writes a forecast month in the owner language', () => {
    expect(monthYear('2027-03-01', 'en-US')).toBe('March 2027')
    expect(monthYear('2027-03-01', 'de-DE')).toBe('März 2027')
  })
})

describe('the savings lens', () => {
  const lensOf = (fields: Parameters<typeof emptyProfile>[0]) =>
    savingsView(emptyProfile(fields), format).lenses[0]!

  it('answers how protected the owner is, in months against the target', () => {
    const lens = lensOf({
      savings: savingsReport([kindReport('savings', 600_000)], {
        contributions: { ...contributions, monthlyCents: { cash: 50_000, invested: 0 } },
      }),
      emergencyFund: fund,
      savingsRate: rate,
    })
    expect(lens.question).toBe('How protected am I?')
    expect(lens.answer).toEqual({
      headline: '2.0 months',
      detail:
        'of essentials covered by your savings. Target 6, about November 2028 at $500 a month.',
      tone: 'attention',
      progress: { value: 2, target: 6 },
    })
    const [building, saving] = lens.meters
    expect(building).toMatchObject({
      id: 'building',
      question: 'What am I building?',
      headline: '$6,000',
      detail: 'across 1 account. About $500 a month goes in.',
      parts: [{ label: 'Savings account', cents: 600_000 }],
    })
    expect(saving).toMatchObject({
      question: 'How much of my pay goes to savings?',
      headline: '8%',
      detail:
        'of take-home pay: $500 a month of $6,000. Counts transfers your bank shows. Money taken from pay, like a pension or a 401(k), counts once you add it under Retirement.',
      tone: 'neutral',
      // No bar and no target by default: payroll saving never reaches the bank.
      progress: null,
    })
    // The answer gives coverage already, so the insight is the forecast.
    expect(lens.insight?.topic).toBe('emergency_pace')
  })

  it('says when the target is met, or what is left without a pace', () => {
    const met = { ...fund, status: 'met' as const, monthsCovered: 6.5 }
    expect(
      lensOf({ savings: savingsReport([kindReport('savings', 1)]), emergencyFund: met }).answer,
    ).toMatchObject({
      headline: '6.5 months',
      detail: expect.stringMatching(/Target 6, reached\.$/),
      tone: 'good',
    })
    const slow = {
      ...fund,
      status: 'building' as const,
      reachesTargetOn: null,
      monthlyPaceCents: null,
    }
    expect(
      lensOf({ savings: savingsReport([kindReport('savings', 1)]), emergencyFund: slow }).answer,
    ).toMatchObject({
      detail: expect.stringMatching(/Target 6, \$12,000 to go\.$/),
      tone: 'neutral',
    })
  })

  it('says what it needs instead of guessing a missing answer or rate', () => {
    const lens = lensOf({ savings: savingsReport([kindReport('savings', 100)]) })
    expect(lens.answer.headline).toBeNull()
    expect(lens.answer.detail).toMatch(/^Once Leeway has a whole month of spending/)
    expect(lens.meters[1]).toMatchObject({
      headline: null,
      detail: 'Leeway needs a whole month of pay to work out your savings rate.',
    })
    const paid = lensOf({
      savings: savingsReport([kindReport('savings', 100)]),
      monthly: { months: 3, incomeCents: 500_000, spendingCents: 1, essentialSpendingCents: 1 },
    })
    expect(paid.meters[1]!.detail).toMatch(/has not seen a month of transfers/)
  })

  it('says plainly where a target the owner set stands, with no bar toward it', () => {
    const saving = (target: number | null) =>
      lensOf({
        savings: savingsReport([kindReport('savings', 1)]),
        savingsRate: rate,
        savingsRateTargetPercent: target,
      }).meters[1]
    expect(saving(5)).toMatchObject({
      detail: expect.stringMatching(/Above your 5% target, counting only bank transfers\.$/),
      tone: 'good',
      progress: null,
    })
    expect(saving(20)).toMatchObject({
      detail:
        'of take-home pay: $500 a month of $6,000. Counts transfers your bank shows. Money taken from pay, like a pension or a 401(k), counts once you add it under Retirement. Your target is 20%, counting only bank transfers.',
      tone: 'neutral',
      progress: null,
    })
    expect(saving(null)).toMatchObject({
      detail:
        'of take-home pay: $500 a month of $6,000. Counts transfers your bank shows. Money taken from pay, like a pension or a 401(k), counts once you add it under Retirement.',
      progress: null,
    })
  })
})

describe('the retirement and investing lenses', () => {
  const view = (kinds: Parameters<typeof savingsReport>[0], fields = {}) =>
    savingsView(emptyProfile({ savings: savingsReport(kinds, fields) }), format)

  it('show the balance and how it moved until there is more to answer with', () => {
    const [retirement, investing] = view(
      [
        kindReport('retirement', 5_000_000, { changes: yearChange(-120_000) }),
        kindReport('investment', 1_200_000, { changes: yearChange(80_000, '2026-01-02') }),
      ],
      { contributions },
    ).lenses
    // Without a birth year there is no projection: the lens shows what is held and asks for one.
    expect(retirement!.question).toBe('Can I stop working on time?')
    expect(retirement!.answer).toEqual({
      headline: '$50,000',
      detail:
        'in retirement across 1 account. -$1,200 since Nov 19. Add your birth year to see what your savings and any pension could pay.',
      tone: 'neutral',
      progress: null,
    })
    expect(retirement!.meters.map((m) => [m.id, m.headline])).toEqual([
      ['growth', '-$1,200'],
      ['contributions', '$6,000'],
    ])
    expect(retirement!.insight?.topic).toBe('contributions')
    expect(investing!.answer).toEqual({
      headline: '+$800',
      detail: 'since Jan 2, counting deposits and market moves together.',
      tone: 'good',
      progress: null,
    })
    expect(investing!.meters[0]).toMatchObject({ id: 'balance', question: 'What do I hold?' })
  })

  it('say where history starts, and that payroll deductions are unseen, when there is nothing yet', () => {
    const [retirement, investing] = view(
      [kindReport('retirement', 100), kindReport('investment', 100)],
      { historyStartsOn: TODAY },
    ).lenses
    expect(investing!.answer.detail).toBe(
      'in investing across 1 account. History starts Nov 19, so changes show from the next day on.',
    )
    expect(retirement!.meters.map((m) => [m.headline, m.detail])).toEqual([
      [null, 'History starts Nov 19, so changes show from the next day on.'],
      [
        null,
        'No transfers from your bank to investment or retirement accounts in the last year. Payroll deductions, like a 401(k), do not show in bank transactions.',
      ],
    ])
    expect(retirement!.insight).toBeNull()
    const [fresh] = view([kindReport('investment', 100)], { historyStartsOn: null }).lenses
    expect(fresh!.answer.detail).toMatch(
      /Changes show once Leeway has a balance from an earlier day\.$/,
    )
  })
})

describe('savingsView', () => {
  it('puts each goal in the lens of the account it follows, savings otherwise', () => {
    const profile = emptyProfile({
      savings: savingsReport([kindReport('savings', 600_000), kindReport('retirement', 100)]),
      goals: [
        goal('Trip'),
        goal('Retire early', { accountKind: 'retirement' }),
        goal('Car', { accountKind: 'checking' }),
      ],
    })
    const { lenses } = savingsView(profile, format)
    expect(lenses.map((v) => [v.kind, v.goals.map((g) => g.name), v.emergencyFund])).toEqual([
      ['savings', ['Trip', 'Car'], null],
      ['retirement', ['Retire early'], null],
    ])
    expect(lenses[0]!.insights.every((i) => i.about === 'savings')).toBe(true)
    expect(goalLens(goal('Any'))).toBe('savings')
  })

  it('signs a change in money words', () => {
    expect([1, -1, 0].map((c) => signedMoney(c * 100, dollars))).toEqual(['+$1', '-$1', '$0'])
  })
})
