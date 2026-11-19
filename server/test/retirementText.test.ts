// How retirement is put in words, with no AI: the retirement lens and its
// pension cards, the retirement insight and the digest an assistant reads.

import { describe, expect, it } from 'vitest'
import { profileDigest } from '../src/domain/profile/digest.js'
import type { FinancialProfile } from '../src/domain/profile/profile.js'
import { retirementInsight } from '../src/domain/profile/insights.js'
import { middleCase, middleFigure, percent, range } from '../src/domain/profile/rangeWords.js'
import { CONTRIBUTION_NOT_SET, PENSION_LABEL } from '../src/domain/profile/retirementLens.js'
import { lensKinds, retirementView, savingsView } from '../src/domain/profile/views.js'
import { FORMULA_NOTE, pensionMonthlyTotals } from '../src/domain/retirement/pensions.js'
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
    pensionPay: pensionMonthlyTotals(pensions, null),
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

/** The same, with a target the pension and savings meet. */
const met = () => profileWith([pera], { ...owner, targetMonthlyIncomeCents: 300_000 })

describe('the retirement lens', () => {
  it('answers with the share of the target covered, naming the pension, once the target is met', () => {
    const { lens } = retirementView(met(), format)
    expect(lens.question).toBe('Can I retire at 60?')
    expect(lens.answer).toEqual({
      headline: 'On track',
      detail:
        'Your pension and savings should cover 102% to 130% of the $3,000 a month you want, most likely about 113%.',
      tone: 'good',
      progress: { value: 113, target: 100 },
    })
  })

  it('gives a pension holder short of the target the figures, with no verdict, bar or gap', () => {
    const { lens } = retirementView(profileWith([pera]), format)
    expect(lens.answer).toEqual({
      headline: '$3,052 to $3,907 a month',
      detail:
        "from your pension and savings at 60, in today's dollars. Your pension gives about $2,180 of it.",
      tone: 'neutral',
      progress: null,
    })
    expect(lens.meters.every((meter) => meter.progress === null)).toBe(true)
    expect(lens.insight).toBeNull()
  })

  it('says plainly when a pension starts after the retirement age, with no verdict for that age', () => {
    const { lens } = retirementView(profileWith(), format)
    expect(lens.answer).toEqual({
      headline: 'Your pension starts at 62',
      detail:
        "Until then, you could have $3,052 to $3,907 a month at 60, in today's dollars. Leeway counts your pension from 62, so it gives no verdict at 60.",
      tone: 'neutral',
      progress: null,
    })
    const income = lens.meters.find((meter) => meter.id === 'retirement_income')!
    expect(income).toMatchObject({
      detail: 'most likely about $3,399. Your pension starts at 62 and is not in this figure.',
      progress: null,
    })
    expect(lens.insight).toBeNull()
  })

  it('projects an owner past the retirement age for now, never for an age behind them', () => {
    const past = profileWith([pera], { birthYear: 1955, retirementAge: 65 })
    const { lens } = retirementView(past, format)
    expect(lens.question).toBe('Can I retire now?')
    expect(lens.answer.detail).toBe(
      "from your pension and savings now, in today's dollars. Your pension gives about $2,180 of it.",
    )
    const [savings, income] = lens.meters
    expect(savings).toMatchObject({
      question: 'Savings now',
      headline: '$72,000',
      detail:
        'the savings you have to draw on today. That counts $2,000 of cash beyond your emergency fund.',
    })
    expect(income).toMatchObject({ question: 'Monthly income now', headline: '$2,420' })
    const later = profileWith([{ ...pera, plan: { ...pera.plan, benefitAge: 75 } }], {
      birthYear: 1955,
      retirementAge: 65,
    })
    expect(retirementView(later, format).lens.answer.detail).toBe(
      "Until then, you could have $240 a month now, in today's dollars. Leeway counts your pension from 75, so it gives no verdict now.",
    )
  })

  it('shows savings and income at retirement as ranges, saying what they start from', () => {
    const [projection, income, contributions] = retirementView(met(), format).lens.meters
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
        'most likely about $3,399. Your pension gives about $2,180 of it, and the $3,000 you want is met.',
      progress: { value: 339_946, target: 300_000 },
      parts: [
        { label: PENSION_LABEL, cents: 218_000 },
        { label: 'Savings at 4% a year', cents: 121_946 },
      ],
    })
    // What goes into the pension from pay: 11% of $3,845 twice a month, and the employer's share.
    expect(contributions).toMatchObject({
      id: 'contributions',
      headline: '$846 a month',
      detail: 'from your pay into your pension, and your employer adds about $1,646.',
    })
  })

  it('says what goes into a pension from pay, and what the bank sent too, never that nothing goes in', () => {
    const contributions = (profile: FinancialProfile) =>
      retirementView(profile, format).lens.meters.find((meter) => meter.id === 'contributions')!
    const sent = {
      since: '2025-11-20',
      totalCents: { cash: 0, invested: 120_000 },
      monthlyCents: null,
      transferCount: 4,
    }
    const withBank = (profile: FinancialProfile) => ({
      ...profile,
      savings: { ...profile.savings, contributions: sent },
    })
    expect(contributions(withBank(met()))).toMatchObject({
      headline: '$846 a month',
      detail:
        'from your pay into your pension, and your employer adds about $1,646. Also $1,200 from your bank into investment and retirement accounts since Nov 20.',
    })
    // The employer's share, when the plan does not give it, is left out.
    const memberOnly = { ...met(), pensionPay: { memberCents: 84_600, employerCents: null } }
    expect(contributions(memberOnly).detail).toBe('from your pay into your pension.')
    // With no contribution entered, it asks for one, after any bank transfers.
    const notEntered = { ...met(), pensionPay: { memberCents: null, employerCents: null } }
    expect(contributions(notEntered)).toMatchObject({
      headline: null,
      detail: 'Your pension contribution is not entered yet. Your paystub shows it.',
    })
    expect(contributions(withBank(notEntered))).toMatchObject({
      headline: '$1,200',
      detail:
        'from your bank into investment and retirement accounts since Nov 20. Your pension contribution is not entered yet. Your paystub shows it.',
    })
  })

  it('says what a later age would do for savings alone, never that the owner should save more', () => {
    const savingsOnly = profileWith([], { ...owner, targetMonthlyIncomeCents: 140_000 })
    const { lens } = retirementView(savingsOnly, format)
    expect(lens.insight?.text).toBe(
      'Of the $1,400 a month you want at 60, savings give about $1,219 a month in the middle case. Retiring at 63 instead of 60 would meet it, with no change to what you put in.',
    )
    expect(lens.insight?.text).not.toMatch(/save more|under-?sav|should/i)
  })

  it('gives room to spare, or savings alone, in the same plain words', () => {
    expect(retirementInsight(met(), format)?.text).toMatch(
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
    // Savings alone are no shortfall while the pension may cover the rest.
    const income = view.lens.meters.find((meter) => meter.id === 'retirement_income')
    expect(income).toMatchObject({ progress: null, parts: [{ label: 'Savings at 4% a year' }] })
    expect(income!.detail).toMatch(/A pension counts here once its monthly benefit is entered\.$/)
  })

  it('gives the income range alone without a target', () => {
    const noTarget = profileWith([], { birthYear: 1990, retirementAge: 60 })
    expect(retirementView(noTarget, format).lens.answer).toMatchObject({
      headline: '$872 to $1,727 a month',
      detail:
        'of income at 60. Set a target income, or give Leeway a whole month of spending, to see whether that is enough.',
    })
    const [, income] = retirementView(noTarget, format).lens.meters
    expect(income!.detail).toBe('most likely about $1,219. Set a target income to compare against.')
    // With a pension, the figures alone, and what the pension gives of them.
    const withPension = profileWith([pera], { birthYear: 1990, retirementAge: 60 })
    expect(retirementView(withPension, format).lens.answer.detail).toBe(
      "from your pension and savings at 60, in today's dollars. Your pension gives about $2,180 of it.",
    )
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
    // Nothing saved gives $0 in every case, so there is no middle case to name.
    expect(lens.meters[1]!.detail).toBe('Your target is $3,000 a month, your recent spending.')
    expect(lens.meters[0]).toMatchObject({
      question: 'Savings now',
      detail: 'the savings you have to draw on today.',
    })
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
        `Retirement at 60 (now about 36): savings $261,487 to $518,213, income $3,052 to $3,907 a month including pensions started by then; not compared with the target, since a pension starts at 62, after 60; returns 1.5% to 5.4% after inflation. ${PROJECTION_NOTE}`,
        'A defined-benefit pension is retirement saving: never call low or missing IRA, 401(k) or brokerage contributions under-saving.',
      ]),
    )
    expect(lines.join('\n')).not.toMatch(/Colorado PERA|Old plan/)
  })

  it('compares with the target only where the lens gives a verdict', () => {
    const verdict = (profile: ReturnType<typeof profileWith>) =>
      profileDigest(profile, dollars)
        .split('\n')
        .find((line) => line.startsWith('Retirement'))
    expect(verdict(met())).toContain(
      'including pensions started by then against a $3,000 target (102% to 130%, most likely 113%);',
    )
    // Short of the target with a pension: the figures, and no comparison at all.
    expect(verdict(profileWith([pera]))).toContain(
      'a month including pensions started by then; returns',
    )
    expect(verdict(profileWith([pera], { birthYear: 1955, retirementAge: 65 }))).toMatch(
      /^Retirement now, at 71 \(past the planned 65\): savings \$72,000, income \$2,420 a month/,
    )
  })

  it('gives a range whose ends agree as one figure, in the lens and the digest alike', () => {
    // Past the planned age, savings are what is held today, and the pension's figure is fixed.
    const now = profileWith([pera], {
      birthYear: 1955,
      retirementAge: 65,
      targetMonthlyIncomeCents: 200_000,
    })
    const { lens } = retirementView(now, format)
    expect(lens.answer.detail).toBe(
      'Your pension and savings should cover 121% of the $2,000 a month you want.',
    )
    const [savings, income] = lens.meters
    expect(savings).toMatchObject({ question: 'Savings now', headline: '$72,000' })
    expect(income).toMatchObject({
      question: 'Monthly income now',
      headline: '$2,420',
      detail: 'Your pension gives about $2,180 of it, and the $2,000 you want is met.',
    })
    // No meter or answer says one figure twice, as a range or as its middle case.
    for (const words of [lens.answer, ...lens.meters]) {
      expect(`${words.headline} ${words.detail}`).not.toMatch(/(\$[\d,]+) to \1|most likely/)
    }
    const line = profileDigest(now, dollars)
      .split('\n')
      .find((text) => text.startsWith('Retirement'))!
    expect(line).toContain('savings $72,000, income $2,420 a month')
    expect(line).toContain('against a $2,000 target (121%);')
    expect(line).not.toMatch(/(\$[\d,]+) to \1|(\d+%) to \2|most likely/)
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

describe('range words', () => {
  const spread = { low: 81, mid: 100, high: 136 }
  const fixed = { low: 121, mid: 121, high: 121 }

  it('give a range, or one figure when its ends agree', () => {
    expect(range(spread, percent)).toBe('81% to 136%')
    expect(range(fixed, percent)).toBe('121%')
  })

  it('name the middle case only under a range', () => {
    expect(middleFigure(spread, percent)).toBe('100%')
    expect(middleFigure(fixed, percent)).toBeNull()
    expect(middleCase(spread, percent)).toBe(', most likely 100%')
    expect(middleCase(spread, dollars, 'most likely about')).toBe(', most likely about $1')
    expect(middleCase(fixed, percent)).toBe('')
  })
})
