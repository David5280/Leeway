// The retirement lens: "Can I retire at 65?" answered from the projection
// (retirement/plan.ts), with meters for the savings range and the monthly
// income it gives, and a card per pension. Without a birth year it shows what
// is held and asks for one. Every figure is a range or says where it came
// from, and none tells the owner to save more: a gap is shown with a choice
// that closes it, and a pension always counts as retirement saving.

import { FORMULA_NOTE } from '../retirement/pensions.js'
import type { PensionInPlan, Projection, RetirementPlan } from '../retirement/plan.js'
import type { InsightFormat } from './insights.js'
import { growthMeter, LENS_QUESTIONS, type Lens, type LensAnswer, type Meter } from './lens.js'
import { balanceAnswer, contributionsMeter, pick, type LensInput } from './lenses.js'
import { middleCase, middleFigure, percent, range } from './rangeWords.js'

/** Each pension as its card shows it, in words. */
export interface PensionCard {
  accountId: string
  name: string
  /** Always the same: a reminder that Leeway did not find these figures itself. */
  label: string
  /** "$2,180 / mo", a range for a benefit from the formula, or null while unknown. */
  benefit: string | null
  benefitDetail: string
  /** Said beside a benefit worked out from the formula; null otherwise. */
  benefitNote: string | null
  /** "$423 a paycheck", "11% of pay", or the line that asks for it. */
  contribution: string
  contributionSet: boolean
  /** What the employer adds, or null when the owner has not said. */
  employer: string | null
  /** Counted in income at the planned retirement age. */
  counted: boolean
  checkedOn: string | null
}

/** The label every pension figure carries: Leeway never finds a pension on its own. */
export const PENSION_LABEL = 'Pension, entered by you'

/** What a pension card says while its contribution is blank. */
export const CONTRIBUTION_NOT_SET = 'Contribution not entered yet. Your paystub shows it.'

const ON_TRACK_WORDS = { on_track: 'On track', close: 'Close', below_target: 'Below target' }

const ASK_FOR_BENEFIT =
  "Add the monthly benefit from your plan's statement, or the salary, multiplier and years of service its formula uses."

/** When the projection is for, in words: "at 60", or "now" for an owner past the planned age. */
function when(projection: Projection): string {
  return projection.yearsToGo > 0 ? `at ${projection.atAge}` : 'now'
}

/** One decimal at most: 12.5 years, 20 years. */
const years = (value: number) => `${Math.round(value * 10) / 10} years`

function benefitDetail(
  pension: PensionInPlan,
  plan: RetirementPlan,
  money: InsightFormat['money'],
) {
  const { benefit, startsAge, plan: details } = pension
  if (!benefit) return ASK_FOR_BENEFIT
  let detail = `From your plan's statement, starting at ${startsAge}.`
  if (benefit.source === 'formula') {
    const age = plan.projection?.age
    // Without a birth year the extra service cannot be counted, so the cases agree.
    detail =
      benefit.low === benefit.mid || age === undefined
        ? `From the plan's formula with your figures, starting at ${startsAge}.`
        : `${money(benefit.low)} for your service so far, ${money(benefit.mid)} with ${years(details.serviceYears! + startsAge - age)} by ${startsAge}.`
  }
  const atAge = plan.projection?.atAge ?? plan.assumptions.retirementAge
  if (!pension.counted) {
    detail += ` It starts after ${atAge}, so income at ${atAge} leaves it out.`
  }
  return detail
}

function contributionWords(pension: PensionInPlan, { money }: InsightFormat): string {
  const { contribution } = pension.plan
  if (!contribution) return CONTRIBUTION_NOT_SET
  if (contribution.kind === 'amount') return `${money(contribution.cents)} a paycheck`
  const perPaycheck = pension.payIn.perPaycheckCents
  // A percent becomes an amount only once gross pay is known.
  if (perPaycheck === null) return `${contribution.percent}% of pay`
  return `${money(perPaycheck)} a paycheck (${contribution.percent}% of pay)`
}

function employerWords(pension: PensionInPlan, { money }: InsightFormat): string | null {
  const percent = pension.plan.employerContributionPercent
  if (percent === null) return null
  const monthly = pension.payIn.employerMonthlyCents
  if (monthly === null) return `Your employer adds ${percent}% of pay.`
  return `Your employer adds about ${money(monthly)} a month (${percent}% of pay).`
}

export function pensionCards(plan: RetirementPlan, format: InsightFormat): PensionCard[] {
  return plan.pensions.map((pension) => ({
    accountId: pension.accountId,
    name: pension.name,
    label: PENSION_LABEL,
    benefit: pension.benefit && `${range(pension.benefit, format.money)} / mo`,
    benefitDetail: benefitDetail(pension, plan, format.money),
    benefitNote: pension.benefit?.source === 'formula' ? FORMULA_NOTE : null,
    contribution: contributionWords(pension, format),
    contributionSet: pension.plan.contribution !== null,
    employer: employerWords(pension, format),
    counted: pension.counted,
    checkedOn: pension.plan.checkedOn,
  }))
}

/** Whose income it is, in words: a pension is always named when there is one. */
function whose(plan: RetirementPlan): string {
  return plan.hasPension ? 'Your pension and savings' : 'Your savings'
}

/**
 * The answer while a pension starts after the age projected: when it starts,
 * and the income until then, with no verdict, since the pension may cover
 * the target once it starts.
 */
function laterPensionAnswer(
  projection: Projection,
  startsAge: number,
  money: InsightFormat['money'],
): LensAnswer {
  return {
    headline: `Your pension starts at ${startsAge}`,
    detail: `Until then, you could have ${range(projection.income.total, money)} a month ${when(projection)}, in today's dollars. Leeway counts your pension from ${startsAge}, so it gives no verdict ${when(projection)}.`,
    tone: 'neutral',
    progress: null,
  }
}

/**
 * The answer: "On track" with the share of the target covered, when Leeway
 * can judge it; otherwise the income as figures, with no verdict.
 */
function onTrackAnswer(
  plan: RetirementPlan,
  projection: Projection,
  { money }: InsightFormat,
): LensAnswer {
  const { coverage, onTrack, target, income, laterPensionAge } = projection
  if (coverage && target && onTrack) {
    const who = whose(plan)
    return {
      headline: ON_TRACK_WORDS[onTrack],
      detail: `${who} should cover ${range(coverage, percent)} of the ${money(target.monthlyCents)} a month you want${middleCase(coverage, percent, 'most likely about')}.`,
      // Below target is a fact to weigh, not an alarm.
      tone: onTrack === 'on_track' ? 'good' : 'neutral',
      progress: { value: coverage.mid, target: 100 },
    }
  }
  if (plan.pensionsWithoutBenefit > 0) {
    return {
      headline: null,
      detail: "Add your pension's monthly benefit to see whether you are on track.",
      tone: 'neutral',
      progress: null,
    }
  }
  if (laterPensionAge !== null) return laterPensionAnswer(projection, laterPensionAge, money)
  const headline = `${range(income.total, money)} a month`
  if (plan.hasPension) {
    return {
      headline,
      detail: `from your pension and savings ${when(projection)}, in today's dollars. Your pension gives about ${money(income.pension.mid)} of it.`,
      tone: 'neutral',
      progress: null,
    }
  }
  return {
    headline,
    detail: `of income ${when(projection)}. Set a target income, or give Leeway a whole month of spending, to see whether that is enough.`,
    tone: 'neutral',
    progress: null,
  }
}

/** How savings get from today to the age projected: what goes in, and the returns. */
function growthWords(projection: Projection, money: InsightFormat['money']): string {
  const { realReturns, contribution, startingSavings } = projection
  // Already at or past the planned age, savings are what is held today.
  if (projection.yearsToGo === 0) return 'the savings you have to draw on today.'
  const adding = {
    entered: ` and ${money(contribution.monthlyCents)} a month`,
    found: ` and about ${money(contribution.monthlyCents)} a month going in`,
    none: '',
  }[contribution.source]
  return `in today's dollars, from ${money(startingSavings.totalCents)} now${adding}, with returns of ${range(realReturns, percent)} after inflation.`
}

/** Savings at the age projected as a range, with the chart of how they get there. */
function projectionMeter(projection: Projection, { money }: InsightFormat): Meter {
  const { savingsAtRetirement: at, startingSavings } = projection
  const cash =
    startingSavings.cashCents > 0
      ? ` That counts ${money(startingSavings.cashCents)} of cash beyond your emergency fund.`
      : ''
  return {
    id: 'projection',
    question: projection.yearsToGo > 0 ? `Savings at ${projection.atAge}` : 'Savings now',
    headline: range(at, money),
    detail: `${growthWords(projection, money)}${cash}`,
    tone: 'neutral',
    progress: null,
    parts: [],
    series: [],
    band: projection.band,
  }
}

/**
 * What the income range is measured against. A pension with no benefit
 * entered yet, or one that starts later, adds nothing to the range, so that
 * comes first: a comparison with the target would then read as a shortfall
 * the pension may well cover. With a pension, the target is named only once
 * the income meets it.
 */
function incomeAgainst(
  plan: RetirementPlan,
  projection: Projection,
  money: InsightFormat['money'],
): string {
  const { income, target, laterPensionAge } = projection
  if (plan.pensionsWithoutBenefit > 0) {
    return 'A pension counts here once its monthly benefit is entered.'
  }
  if (laterPensionAge !== null) {
    return `Your pension starts at ${laterPensionAge} and is not in this figure.`
  }
  if (plan.hasPension) {
    const pension = `Your pension gives about ${money(income.pension.mid)} of it`
    const met = target && projection.onTrack
    return met
      ? `${pension}, and the ${money(target.monthlyCents)} you want is met.`
      : `${pension}.`
  }
  if (!target) return 'Set a target income to compare against.'
  const from = target.source === 'spending' ? ', your recent spending' : ''
  return `Your target is ${money(target.monthlyCents)} a month${from}.`
}

function incomeMeter(
  plan: RetirementPlan,
  projection: Projection,
  { money }: InsightFormat,
): Meter {
  const { income, target } = projection
  const pension = income.pension.mid
  const parts = [
    ...(pension > 0 ? [{ label: PENSION_LABEL, cents: pension }] : []),
    {
      label: `Savings at ${plan.assumptions.withdrawalPercent}% a year`,
      cents: income.savings.mid,
    },
  ]
  // A bar only where Leeway gives a verdict, so it never shows a shortfall it would not say.
  const compared = target !== null && projection.coverage !== null
  // Under a range, the middle case; under one figure, nothing to repeat.
  const middle = middleFigure(income.total, money)
  const against = incomeAgainst(plan, projection, money)
  return {
    id: 'retirement_income',
    question:
      projection.yearsToGo > 0 ? `Monthly income at ${projection.atAge}` : 'Monthly income now',
    headline: range(income.total, money),
    detail: middle === null ? against : `most likely about ${middle}. ${against}`,
    tone: 'neutral',
    progress: compared ? { value: income.total.mid, target: target.monthlyCents } : null,
    parts,
    series: [],
    band: [],
  }
}

/** Before a birth year: what is held, if anything, and a request for the year. */
function waitingAnswer({ profile, report, format }: LensInput): LensAnswer {
  const ask = 'Add your birth year to see what your savings and any pension could pay.'
  if (report.accounts.length === 0) {
    return { headline: null, detail: ask, tone: 'neutral', progress: null }
  }
  const held = balanceAnswer(report, profile, format)
  return { ...held, detail: `${held.detail} ${ask}` }
}

export function retirementLens(input: LensInput): Lens<'retirement'> {
  const { profile, report, insights, format } = input
  const plan = profile.retirement
  const { projection } = plan
  const insight = pick(insights, ['retirement', 'goal', 'contributions', 'change'])
  if (!projection) {
    return {
      kind: 'retirement',
      ...LENS_QUESTIONS.retirement,
      answer: waitingAnswer(input),
      meters: [
        growthMeter(report.changes, report.history, profile.savings.historyStartsOn, format),
        contributionsMeter(profile, format),
      ],
      insight,
    }
  }
  return {
    kind: 'retirement',
    title: LENS_QUESTIONS.retirement.title,
    question:
      projection.yearsToGo > 0
        ? `Can I retire at ${projection.retirementAge}?`
        : 'Can I retire now?',
    answer: onTrackAnswer(plan, projection, format),
    meters: [
      projectionMeter(projection, format),
      incomeMeter(plan, projection, format),
      contributionsMeter(profile, format),
    ],
    insight,
  }
}
