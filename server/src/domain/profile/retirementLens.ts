// The retirement lens: "Can I retire at 65?" answered from the projection
// (retirement/plan.ts), with meters for the savings range and the monthly
// income it gives, and a card per pension. Without a birth year it shows what
// is held and asks for one. Every figure is a range or says where it came
// from, and none tells the owner to save more: a gap is shown with a choice
// that closes it, and a pension always counts as retirement saving.

import { FORMULA_NOTE } from '../retirement/pensions.js'
import type { PensionInPlan, Projection, RetirementPlan } from '../retirement/plan.js'
import type { Band } from '../retirement/projection.js'
import type { InsightFormat } from './insights.js'
import {
  CONTRIBUTION_NOT_SET,
  growthMeter,
  LENS_QUESTIONS,
  PENSION_LABEL,
  type Lens,
  type LensAnswer,
  type Meter,
} from './lens.js'
import { balanceAnswer, contributionsMeter, pick, type LensInput } from './lenses.js'

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

const ON_TRACK_WORDS = { on_track: 'On track', close: 'Close', below_target: 'Below target' }

const ASK_FOR_BENEFIT =
  "Add the monthly benefit from your plan's statement, or the salary, multiplier and years of service its formula uses."

/** "$1,200 to $1,800", or one figure when the cases agree. */
function range(band: Band, money: InsightFormat['money']): string {
  return band.low === band.high ? money(band.mid) : `${money(band.low)} to ${money(band.high)}`
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
  const { retirementAge } = plan.assumptions
  if (!pension.counted) {
    detail += ` It starts after ${retirementAge}, so income at ${retirementAge} leaves it out.`
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

/** "On track", with the range of the target it covers. */
function onTrackAnswer(
  plan: RetirementPlan,
  projection: Projection,
  { money }: InsightFormat,
): LensAnswer {
  const { coverage, onTrack, target, income } = projection
  if (coverage && target && onTrack) {
    const who = income.pension.mid > 0 ? 'Your pension and savings' : 'Your savings'
    return {
      headline: ON_TRACK_WORDS[onTrack],
      detail: `${who} should cover ${coverage.low}% to ${coverage.high}% of the ${money(target.monthlyCents)} a month you want, most likely about ${coverage.mid}%.`,
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
  return {
    headline: `${range(income.total, money)} a month`,
    detail: `of income at ${projection.retirementAge}. Set a target income, or give Leeway a whole month of spending, to see whether that is enough.`,
    tone: 'neutral',
    progress: null,
  }
}

/** Savings at retirement as a range, with the chart of how they get there. */
function projectionMeter(projection: Projection, { money }: InsightFormat): Meter {
  const { savingsAtRetirement: at, realReturns, contribution, startingSavings } = projection
  const adding = {
    entered: ` and ${money(contribution.monthlyCents)} a month`,
    found: ` and about ${money(contribution.monthlyCents)} a month going in`,
    none: '',
  }[contribution.source]
  const cash =
    startingSavings.cashCents > 0
      ? ` That counts ${money(startingSavings.cashCents)} of cash beyond your emergency fund.`
      : ''
  return {
    id: 'projection',
    question: `Savings at ${projection.retirementAge}`,
    headline: range(at, money),
    detail: `in today's dollars, from ${money(startingSavings.totalCents)} now${adding}, with returns of ${realReturns.low}% to ${realReturns.high}% after inflation.${cash}`,
    tone: 'neutral',
    progress: null,
    parts: [],
    series: [],
    band: projection.band,
  }
}

/** Monthly income at retirement, from pensions and savings, against the target. */
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
  let against = 'Set a target income to compare against.'
  if (target && pension > 0) {
    const share = Math.round((pension / target.monthlyCents) * 100)
    against = `Your pension alone covers about ${share}% of your ${money(target.monthlyCents)} target.`
  } else if (target) {
    const from = target.source === 'spending' ? ', your recent spending' : ''
    against = `Your target is ${money(target.monthlyCents)} a month${from}.`
  }
  return {
    id: 'retirement_income',
    question: `Monthly income at ${projection.retirementAge}`,
    headline: range(income.total, money),
    detail: `most likely about ${money(income.total.mid)}. ${against}`,
    tone: 'neutral',
    progress: target ? { value: income.total.mid, target: target.monthlyCents } : null,
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
