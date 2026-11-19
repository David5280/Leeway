// How retirement is put in words, with no AI: the retirement lens and its
// pension cards, the retirement insight and the digest an assistant reads.

import { describe, expect, it } from 'vitest'
import { profileDigest } from '../src/domain/profile/digest.js'
import { retirementInsight } from '../src/domain/profile/insights.js'
import { CONTRIBUTION_NOT_SET, PENSION_LABEL } from '../src/domain/profile/retirementLens.js'
import { lensKinds, retirementView, savingsView } from '../src/domain/profile/views.js'
import { FORMULA_NOTE } from '../src/domain/retirement/pensions.js'
import { PROJECTION_NOTE } from '../src/domain/retirement/plan.js'
import {
  bankSeenRate,
  PENSION_COUNTED,
  RATE_GUARD_FOR_AI,
  savingsRate,
} from '../src/domain/savings/rate.js'
import {
  dollars,
  emptyProfile,
  kindReport,
  pension,
  retirement,
  savingsReport,
} from './fixtures/profile.js'

const format = { money: dollars, locale: 'en-US' }

/** 11% of $3,845 twice a month, a 21.4% employer share and a $2,180 benefit from the statement. */
const pera = pension(
  {
    contribution: { kind: 'percent', percent: 11 },
    grossPayCents: 384_500,
    payCadence: 'semimonth',
    employerContributionPercent: 21.4,
    statementBenefitMonthlyCents: 218_000,
    checkedOn: '2026-10-01',
  },
  { balanceCents: 4_500_000 },
)

/** An old plan worked out by its formula, $6,000 x 2.5% x years, paying from 62. */
const oldPlan = pension(
  { salaryBasisMonthlyCents: 600_000, multiplierPercent: 2.5, serviceYears: 10, benefitAge: 62 },
  { accountId: 'pension-2', name: 'Old plan' },
)

const owner = { birthYear: 1990, retirementAge: 60, targetMonthlyIncomeCents: 420_000 }

/** $70,000 in retirement accounts, $2,000 of cash beyond the emergency fund, and these pensions. */
function profileWith(pensions = [pera, oldPlan], assumptions: object = owner) {
  return emptyProfile({
    savings: savingsReport([kindReport('retirement', 7_000_000)]),
    retirement: retirement(
      {
        retirementCents: 7_000_000,
        cashCents: 2_000_000,
        emergencyTargetCents: 1_800_000,
        foundMonthlyContributionCents: 46_300,
        pensions,
      },
      assumptions,
    ),
  })
}

describe('the retirement lens', () => {
  it('answers with the share of the target the range covers, pension and savings together', () => {
    const { lens } = retirementView(profileWith(), format)
    expect(lens.question).toBe('Can I retire at 60?')
    expect(lens.answer).toEqual({
      headline: 'Close',
      detail:
        'Your pension and savings should cover 73% to 93% of the $4,200 a month you want, most likely about 81%.',
      tone: 'neutral',
      progress: { value: 81, target: 100 },
    })
  })

  it('shows savings and income at retirement as ranges, saying what they start from', () => {
    const [projection, income, contributions] = retirementView(profileWith(), format).lens.meters
    expect(projection).toMatchObject({
      id: 'projection',
      question: 'Savings at 60',
      headline: '$261,487 to $518,213',
      detail:
        "in today's dollars, from $72,000 now and about $463 a month going in, with returns of 1.5% to 5.4% after inflation. That counts $2,000 of cash beyond your emergency fund.",
    })
    expect(projection!.band).toHaveLength(25)
    expect(income).toMatchObject({
      id: 'retirement_income',
      headline: '$3,052 to $3,907',
      detail:
        'most likely about $3,399. Your pension alone covers about 52% of your $4,200 target.',
      progress: { value: 339_946, target: 420_000 },
      parts: [
        { label: PENSION_LABEL, cents: 218_000 },
        { label: 'Savings at 4% a year', cents: 121_946 },
      ],
    })
    expect(contributions!.id).toBe('contributions')
  })

  it('says what a later age would do, never that the owner should save more', () => {
    const { lens } = retirementView(profileWith(), format)
    expect(lens.insight?.text).toBe(
      'Of the $4,200 a month you want at 60, your pension gives about $2,180 a month and savings about $1,219 in the middle case. Retiring at 62 instead of 60 would meet it, with no change to what you put in.',
    )
    expect(lens.insight?.text).not.toMatch(/save more|under-?sav|should/i)
  })

  it('gives room to spare, or savings alone, in the same plain words', () => {
    const met = profileWith([pera], { ...owner, targetMonthlyIncomeCents: 300_000 })
    expect(retirementInsight(met, format)?.text).toMatch(
      /^In the middle case you would have about \$3,399 a month at 60, \$399 more than the \$3,000 you want\.$/,
    )
    const savingsOnly = profileWith([], { ...owner, targetMonthlyIncomeCents: 900_000 })
    expect(retirementInsight(savingsOnly, format)?.text).toBe(
      'Of the $9,000 a month you want at 60, savings give about $1,219 a month in the middle case.',
    )
    expect(retirementView(savingsOnly, format).lens.answer.detail).toMatch(/^Your savings should/)
  })

  it('waits for every pension benefit before saying whether the owner is on track', () => {
    const view = retirementView(profileWith([pension()]), format)
    expect(view.lens.answer).toEqual({
      headline: null,
      detail: "Add your pension's monthly benefit to see whether you are on track.",
      tone: 'neutral',
      progress: null,
    })
    expect(retirementInsight(profileWith([pension()]), format)).toBeNull()
  })

  it('gives the income range alone without a target', () => {
    const noTarget = profileWith([pera], { birthYear: 1990, retirementAge: 60 })
    expect(retirementView(noTarget, format).lens.answer).toMatchObject({
      headline: '$3,052 to $3,907 a month',
      detail:
        'of income at 60. Set a target income, or give Leeway a whole month of spending, to see whether that is enough.',
    })
    const [, income] = retirementView(noTarget, format).lens.meters
    expect(income!.detail).toBe('most likely about $3,399. Set a target income to compare against.')
  })

  it('names recent spending as the target when the owner set none', () => {
    const spending = emptyProfile({
      retirement: retirement(
        { recentMonthlySpendingCents: 300_000 },
        { birthYear: 1950, retirementAge: 65 },
      ),
    })
    const { lens } = retirementView(spending, format)
    expect(lens.question).toBe('Can I retire now?')
    expect(lens.meters[1]!.detail).toBe(
      'most likely about $0. Your target is $3,000 a month, your recent spending.',
    )
    expect(lens.meters[0]!.detail).toBe(
      "in today's dollars, from $0 now, with returns of 1.5% to 5.4% after inflation.",
    )
  })

  it('asks for a birth year, showing what is held, before it can project', () => {
    const held = retirementView(profileWith([pera], {}), format).lens
    expect(held.answer.headline).toBe('$70,000')
    expect(held.answer.detail).toMatch(
      /Add your birth year to see what your savings and any pension could pay\.$/,
    )
    expect(held.meters.map((meter) => meter.id)).toEqual(['growth', 'contributions'])
    const nothing = retirementView(
      emptyProfile({ retirement: retirement({ pensions: [pera] }) }),
      format,
    )
    expect(nothing.lens.answer).toEqual({
      headline: null,
      detail: 'Add your birth year to see what your savings and any pension could pay.',
      tone: 'neutral',
      progress: null,
    })
  })
})

describe('pension cards', () => {
  it('say where each benefit came from, and what goes in from pay and the employer', () => {
    const [statement, formula] = retirementView(profileWith(), format).pensions
    expect(statement).toEqual({
      accountId: 'pension-1',
      name: 'Colorado PERA',
      label: PENSION_LABEL,
      benefit: '$2,180 / mo',
      benefitDetail: "From your plan's statement, starting at 60.",
      benefitNote: null,
      contribution: '$423 a paycheck (11% of pay)',
      contributionSet: true,
      employer: 'Your employer adds about $1,646 a month (21.4% of pay).',
      counted: true,
      checkedOn: '2026-10-01',
    })
    expect(formula).toMatchObject({
      benefit: '$1,500 to $5,400 / mo',
      benefitDetail:
        '$1,500 for your service so far, $5,400 with 36 years by 62. It starts after 60, so income at 60 leaves it out.',
      benefitNote: FORMULA_NOTE,
      contribution: CONTRIBUTION_NOT_SET,
      contributionSet: false,
      employer: null,
      counted: false,
    })
  })

  it('ask for what is missing rather than guessing it', () => {
    const partial = pension({
      contribution: { kind: 'percent', percent: 8 },
      employerContributionPercent: 10,
      salaryBasisMonthlyCents: 500_000,
      multiplierPercent: 2,
      serviceYears: 5,
    })
    const amount = pension({ contribution: { kind: 'amount', cents: 30_000 } })
    const cards = retirementView(profileWith([partial, amount, pension()], {}), format).pensions
    expect(cards.map((card) => [card.benefit, card.contribution, card.employer])).toEqual([
      ['$500 / mo', '8% of pay', 'Your employer adds 10% of pay.'],
      [null, '$300 a paycheck', null],
      [null, CONTRIBUTION_NOT_SET, null],
    ])
    // Without a birth year the formula counts only the service so far.
    expect(cards[0]!.benefitDetail).toBe(
      "From the plan's formula with your figures, starting at 65.",
    )
    expect(cards[1]!.benefitDetail).toBe(
      "Add the monthly benefit from your plan's statement, or the salary, multiplier and years of service its formula uses.",
    )
  })
})

describe('the retirement lens among the savings lenses', () => {
  it('shows with a pension or a birth year, even with no retirement account', () => {
    const pensionOnly = emptyProfile({ retirement: retirement({ pensions: [pera] }) })
    expect(lensKinds(pensionOnly).map((k) => [k.kind, k.accounts.length])).toEqual([
      ['retirement', 0],
    ])
    const withSavings = emptyProfile({
      savings: savingsReport([kindReport('savings', 100), kindReport('investment', 100)]),
      retirement: retirement({}, { birthYear: 1990 }),
    })
    expect(lensKinds(withSavings).map((k) => k.kind)).toEqual([
      'savings',
      'retirement',
      'investment',
    ])
    expect(lensKinds(emptyProfile()).map((k) => k.kind)).toEqual([])
  })

  it('carries the plan and the cards on the retirement lens only', () => {
    const { lenses } = savingsView(profileWith(), format)
    expect(
      lenses.map((lens) => [lens.kind, lens.retirement !== null, lens.pensions.length]),
    ).toEqual([['retirement', true, 2]])
  })
})

describe('retirement in the digest', () => {
  it('gives each pension and the projection range, with no names, and the guard', () => {
    const lines = profileDigest(profileWith(), dollars).split('\n')
    expect(lines).toEqual(
      expect.arrayContaining([
        "Pension, entered by the owner: about $2,180 a month from age 60, from the plan's statement; the owner pays $423 a paycheck, about $846 a month; the employer adds 21.4% of pay (about $1,646 a month).",
        'Pension, entered by the owner: $1,500 to $5,400 a month from age 62, worked out from the salary, multiplier and service the owner entered (no plan rules applied); contribution not known yet; starts after the retirement age.',
        `Retirement at 60 (now about 36): savings $261,487 to $518,213, income $3,052 to $3,907 a month including pensions against a $4,200 target (73% to 93%, most likely 81%); returns 1.5% to 5.4% after inflation. ${PROJECTION_NOTE}`,
        'A defined-benefit pension is retirement saving: never call low or missing IRA, 401(k) or brokerage contributions under-saving.',
      ]),
    )
    expect(lines.join('\n')).not.toMatch(/Colorado PERA|Old plan/)
  })

  it('says a target waits on an unknown benefit, and asks for a birth year when it matters', () => {
    const unknown = profileDigest(profileWith([pension()]), dollars)
    expect(unknown).toContain(
      'Pension, entered by the owner: benefit not known yet; contribution not known yet.',
    )
    expect(unknown).toContain(
      '; not compared with the $4,200 target until the pension benefit is known;',
    )
    const noYear = profileDigest(profileWith([pera], {}), dollars)
    expect(noYear).toMatch(/^Not known yet: .*birth year, for retirement projections\.$/m)
    expect(noYear).not.toMatch(/^Retirement at/m)
    expect(profileDigest(emptyProfile(), dollars)).not.toMatch(/birth year|pension/i)
  })
})

describe('a savings rate that counts a pension', () => {
  // $500 a month moved at the bank and $423 taken from pay for the pension.
  const rate = savingsRate(500_000, [
    { label: 'Transfers to savings', monthlyCents: 50_000, beforePaycheck: false },
    { label: 'Pension contributions', monthlyCents: 42_300, beforePaycheck: true },
  ])!
  const profile = emptyProfile({
    savings: savingsReport([kindReport('savings', 600_000)]),
    savingsRate: rate,
    savingsRateTargetPercent: 15,
  })

  it('is a share of pay before the pension, and says what it counted', () => {
    expect(rate).toMatchObject({ percent: 17, savedMonthlyCents: 92_300, payMonthlyCents: 542_300 })
    expect(bankSeenRate(rate)).toEqual({
      percent: 10,
      savedMonthlyCents: 50_000,
      payMonthlyCents: 500_000,
      sources: [{ label: 'Transfers to savings', monthlyCents: 50_000, beforePaycheck: false }],
    })
    expect(bankSeenRate(null)).toBeNull()
    const pensionOnly = savingsRate(500_000, [rate.sources[1]!])
    expect(bankSeenRate(pensionOnly)).toBeNull()
  })

  it('reads the same in the savings lens, the insight and the digest', () => {
    const [savings] = savingsView(profile, format).lenses
    expect(savings!.meters[1]!.detail).toBe(
      `of pay: $923 a month of $5,423. ${PENSION_COUNTED} Above your 15% target, counting bank transfers and your pension.`,
    )
    expect(savingsView(profile, format).insights[0]!.text).toBe(
      `About 17% of your pay goes to savings: $923 a month of $5,423. ${PENSION_COUNTED}`,
    )
    expect(profileDigest(profile, dollars)).toContain(
      `Savings rate from bank transfers and the pension contributions the owner entered: about 17% of pay ($923 of $5,423 a month: transfers to savings $500, pension contributions $423). ${RATE_GUARD_FOR_AI}`,
    )
  })

  it('names the pension in the digest without knowing the employer amount or a birth year', () => {
    const shareOnly = pension({
      contribution: { kind: 'amount', cents: 42_300 },
      employerContributionPercent: 20,
    })
    const digest = profileDigest(
      emptyProfile({ retirement: retirement({ pensions: [shareOnly] }) }),
      dollars,
    )
    expect(digest).toContain(
      'Pension, entered by the owner: benefit not known yet; the owner pays $423 a paycheck; the employer adds 20% of pay.',
    )
    expect(digest).toMatch(/^Not known yet: .*birth year, for retirement projections\.$/m)
  })
})
