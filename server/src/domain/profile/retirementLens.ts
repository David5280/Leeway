// The retirement lens: "Can I retire at 65?" answered from the projection, the
// meters that show the range and the income it gives, and a card per pension.
// Without a birth year it asks for one and shows what is held so far. It
// never tells the owner to save more; a gap is shown with the choices that
// close it.

import type { PensionInPlan, Projection, RetirementPlan } from '../retirement/plan.js'
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
import { contributionsMeter, pick, type LensInput } from './lenses.js'

/** Each pension as its card shows it, in words, beside the numbers behind them. */
export interface PensionCard {
  id: string
  planName: string
  /** Always the same: a reminder that Leeway did not find this figure itself. */
  label: string
  /** "$2,180 / mo", or null until a benefit is entered. */
  benefit: string | null
  benefitDetail: string
  /** "$423 a paycheck", "11% of pay", or the line that asks for it. */
  contribution: string
  contributionSet: boolean
  serviceYears: number | null
  checkedOn: string | null
}

const ON_TRACK_WORDS = { on_track: 'On track', close: 'Close', below_target: 'Below target' }

/** Years of service when the benefit starts: today's, plus the years until then. */
function serviceAtStart(pension: PensionInPlan, projection: Projection | null): number | null {
  if (pension.serviceYears === null) return null
  const years = projection ? projection.yearsToGo : 0
  return Math.round((pension.serviceYears + years) * 10) / 10
}

function benefitDetail(pension: PensionInPlan, plan: RetirementPlan): string {
  if (pension.monthlyBenefitCents === null) {
    return "Add the expected monthly benefit from the plan's statement, or estimate it."
  }
  const age = pension.benefitAge ?? plan.assumptions.retirementAge
  const service = serviceAtStart(pension, plan.projection)
  const withService = service === null ? '' : ` with ${service} years of service`
  if (pension.benefitSource === 'statement') return `From your statement, starting at ${age}.`
  return `Estimated at ${age}${withService}.`
}

function contributionWords(pension: PensionInPlan, { money }: InsightFormat): string {
  const { contribution } = pension
  if (!contribution) return CONTRIBUTION_NOT_SET
  if (contribution.kind === 'amount') return `${money(contribution.cents)} a paycheck`
  const perPaycheck = pension.payIn.perPaycheckCents
  // A percent becomes an amount only once gross pay is known.
  if (perPaycheck === null) return `${contribution.percent}% of pay`
  return `${money(perPaycheck)} a paycheck (${contribution.percent}% of pay)`
}

export function pensionCards(plan: RetirementPlan, format: InsightFormat): PensionCard[] {
  return plan.pensions.map((pension) => ({
    id: pension.id,
    planName: pension.planName,
    label: PENSION_LABEL,
    benefit:
      pension.monthlyBenefitCents === null
        ? null
        : `${format.money(pension.monthlyBenefitCents)} / mo`,
    benefitDetail: benefitDetail(pension, plan),
    contribution: contributionWords(pension, format),
    contributionSet: pension.contribution !== null,
    serviceYears: pension.serviceYears,
    checkedOn: pension.checkedOn,
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
    const who = income.pensionCents > 0 ? 'Your pension and savings' : 'Your savings'
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
      detail: "Add your pension's expected monthly benefit to see whether you are on track.",
      tone: 'neutral',
      progress: null,
    }
  }
  return {
    headline: `${money(income.total.mid)} a month`,
    detail: `of income at ${projection.retirementAge}, most likely. Set a target income, or give Leeway a whole month of spending, to see whether that is enough.`,
    tone: 'neutral',
    progress: null,
  }
}

/** Savings at retirement as a range, with the chart of how they get there. */
function projectionMeter(
  projection: Projection,
  balanceCents: number,
  { money }: InsightFormat,
): Meter {
  const { savingsAtRetirement: at, realReturns, contribution } = projection
  const adding = {
    entered: ` and ${money(contribution.monthlyCents)} a month`,
    found: ` and about ${money(contribution.monthlyCents)} a month going in`,
    none: '',
  }[contribution.source]
  return {
    id: 'projection',
    question: `Savings at ${projection.retirementAge}`,
    headline: `${money(at.low)} to ${money(at.high)}`,
    detail: `likely, in today's dollars, from ${money(balanceCents)} now${adding}. Returns ${realReturns.low}% to ${realReturns.high}% after inflation.`,
    tone: 'neutral',
    progress: null,
    parts: [],
    series: [],
    band: projection.band,
  }
}

/** Monthly income at retirement, split into pension and savings, against the target. */
function incomeMeter(
  plan: RetirementPlan,
  projection: Projection,
  { money }: InsightFormat,
): Meter {
  const { income, target } = projection
  const withdrawal = plan.assumptions.withdrawalPercent
  const parts = [
    ...(income.pensionCents > 0 ? [{ label: PENSION_LABEL, cents: income.pensionCents }] : []),
    { label: `Savings at ${withdrawal}% a year, low case`, cents: income.savings.low },
    { label: 'What good markets add', cents: income.savings.high - income.savings.low },
  ]
  let detail = 'Set a target income to compare against.'
  if (target && income.pensionCents > 0) {
    const share = Math.round((income.pensionCents / target.monthlyCents) * 100)
    detail = `The pension alone covers ${share}% of your ${money(target.monthlyCents)} target.`
  } else if (target) {
    const from = target.source === 'spending' ? ', your recent spending' : ''
    detail = `Your target is ${money(target.monthlyCents)} a month${from}.`
  }
  return {
    id: 'retirement_income',
    question: `Monthly income at ${projection.retirementAge}`,
    headline: money(income.total.mid),
    detail,
    tone: 'neutral',
    progress: target ? { value: income.total.mid, target: target.monthlyCents } : null,
    parts,
    series: [],
    band: [],
  }
}

export function retirementLens({
  profile,
  report,
  insights,
  format,
}: LensInput): Lens<'retirement'> {
  const plan = profile.retirement
  const { projection } = plan
  const insight = pick(insights, ['retirement', 'goal', 'contributions', 'change'])
  if (!projection) {
    return {
      kind: 'retirement',
      ...LENS_QUESTIONS.retirement,
      answer: {
        headline: null,
        detail:
          'Add your birth year to see whether your savings and pension can cover the income you want.',
        tone: 'neutral',
        progress: null,
      },
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
      projectionMeter(projection, report.totalCents, format),
      incomeMeter(plan, projection, format),
      contributionsMeter(profile, format),
    ],
    insight,
  }
}
