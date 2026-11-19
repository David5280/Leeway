/**
 * Retirement: the one place Leeway works out what pensions and savings could
 * pay in retirement. The financial profile holds the result, and the
 * retirement lens, the digest and the weekly email read it there. Pure.
 *
 * How the parts fit:
 * - Assumptions come from settings (assumptions.ts), and the owner can change
 *   every one. Without a birth year there is no projection, only a request
 *   for one.
 * - Savings to draw on are the retirement and investment accounts, plus cash
 *   savings beyond the emergency fund's target: the emergency fund stays for
 *   emergencies. They grow in today's dollars as a low, middle and high case
 *   (projection.ts), with a monthly contribution: the owner's figure, else
 *   transfers Leeway found going to investment and retirement accounts, else
 *   nothing.
 * - Each pension pays its benefit from the age it starts (pensions.ts). A
 *   pension's member balance is not savings to draw on: it is what pays the
 *   benefit, so counting both would count it twice.
 * - Income is the pensions' benefits plus savings drawn at the withdrawal rate,
 *   against a target: the owner's figure, else recent monthly spending.
 * - Whether that is on track is said only when every pension's benefit is
 *   known: a pension with no benefit entered could cover the whole target.
 */

import type { IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import type { RetirementAssumptions } from './assumptions.js'
import {
  pensionBenefit,
  pensionPayIn,
  type Pension,
  type PensionBenefit,
  type PensionPayIn,
} from './pensions.js'
import {
  caseReturns,
  growthBand,
  mapBand,
  realReturnPercent,
  type Band,
  type BandPoint,
} from './projection.js'

/** Within this share of the target, the middle case counts as on track. */
const ON_TRACK_PERCENT = 95
/** Below this share, the middle case is below target rather than close. */
const CLOSE_PERCENT = 75
/** How many years later Leeway looks for a retirement age that meets the target. */
const LATER_YEARS = 5

export type OnTrack = 'on_track' | 'close' | 'below_target'

/** Said with every projection, wherever it is shown. */
export const PROJECTION_NOTE =
  "A range in today's dollars from the assumptions shown, not a promise of what markets or a plan will pay. Social Security is not included."

/** A pension as a projection counts it. */
export interface PensionInPlan extends Pension {
  payIn: PensionPayIn
  /** The monthly benefit at the age it starts, or null while it is unknown. */
  benefit: PensionBenefit | null
  /** The age the benefit starts: the plan's own, else the planned retirement age. */
  startsAge: number
  /** Counted in income at retirement: its benefit is known and starts by then. */
  counted: boolean
}

export interface RetirementInput {
  today: IsoDate
  assumptions: RetirementAssumptions
  /** The counted balances of the owner's retirement and investment accounts. */
  retirementCents: number
  investmentCents: number
  /** Cash in savings accounts, or null without any savings account. */
  cashCents: number | null
  /** The emergency fund's target, or null when essentials are unknown. */
  emergencyTargetCents: number | null
  /** Monthly transfers found going to investment and retirement accounts, if any. */
  foundMonthlyContributionCents: number | null
  /** Average monthly spending lately, if Leeway has a whole month of it. */
  recentMonthlySpendingCents: number | null
  pensions: Pension[]
  /** The pay cadence Leeway found, for pension contributions per month. */
  payCadence: Cadence | null
}

/** What savings a projection starts from. */
export interface StartingSavings {
  retirementCents: number
  investmentCents: number
  /** Cash savings beyond the emergency fund's target. */
  cashCents: number
  /** Cash left for emergencies and not counted: all of it while the target is unknown. */
  cashKeptCents: number
  totalCents: number
}

/** Monthly income at a retirement age, in today's dollars. */
export interface RetirementIncome {
  /** Pension benefits that have started by then. */
  pension: Band
  /** Savings drawn at the withdrawal rate. */
  savings: Band
  total: Band
}

/** A projection ready to show. */
export interface Projection {
  age: number
  retirementAge: number
  yearsToGo: number
  startingSavings: StartingSavings
  contribution: { monthlyCents: number; source: 'entered' | 'found' | 'none' }
  target: { monthlyCents: number; source: 'entered' | 'spending' } | null
  /** Yearly returns after inflation, in percent to one decimal. */
  realReturns: Band
  /** Savings at retirement, in cents of today's dollars. */
  savingsAtRetirement: Band
  /** Each year from now to retirement, for the chart. */
  band: BandPoint[]
  income: RetirementIncome
  /** Total income as a whole percent of the target; null when onTrack is. */
  coverage: Band | null
  /** Null without a target, or while a pension's benefit is unknown. */
  onTrack: OnTrack | null
  /** How far the middle case falls short of the target a month; null when onTrack is. */
  gapMonthlyCents: number | null
  /** The first later age (up to five years) whose middle case meets the target. */
  laterAge: number | null
}

export interface RetirementPlan {
  /** Null until the owner gives a birth year. */
  projection: Projection | null
  /** The assumptions the projection used. */
  assumptions: RetirementAssumptions
  pensions: PensionInPlan[]
  /** Whether a pension is recorded; coaching reads this before saying anything about saving. */
  hasPension: boolean
  /** Recorded pensions whose monthly benefit is not known yet. */
  pensionsWithoutBenefit: number
  note: string
}

/** The owner's age this calendar year: a year early before their birthday, which a projection can bear. */
export function ageIn(today: IsoDate, birthYear: number): number {
  return Number(today.slice(0, 4)) - birthYear
}

function onTrackOf(midPercent: number): OnTrack {
  if (midPercent >= ON_TRACK_PERCENT) return 'on_track'
  return midPercent >= CLOSE_PERCENT ? 'close' : 'below_target'
}

/** Rounded to one decimal, for a return shown as a percent. */
const oneDecimal = (value: number) => Math.round(value * 10) / 10

const ZERO: Band = { low: 0, mid: 0, high: 0 }

const addBands = (a: Band, b: Band): Band => ({
  low: a.low + b.low,
  mid: a.mid + b.mid,
  high: a.high + b.high,
})

/** Savings to draw on now; cash counts only beyond the emergency fund's target. */
function startingSavingsOf(input: RetirementInput): StartingSavings {
  const cash = Math.max(0, input.cashCents ?? 0)
  const target = input.emergencyTargetCents
  const cashCents = target === null ? 0 : Math.max(0, cash - target)
  return {
    retirementCents: input.retirementCents,
    investmentCents: input.investmentCents,
    cashCents,
    cashKeptCents: cash - cashCents,
    totalCents: input.retirementCents + input.investmentCents + cashCents,
  }
}

/** The contribution a projection uses, and where it came from. */
function contributionOf(input: RetirementInput): Projection['contribution'] {
  const entered = input.assumptions.monthlyContributionCents
  if (entered !== null) return { monthlyCents: entered, source: 'entered' }
  const found = input.foundMonthlyContributionCents
  if (found) return { monthlyCents: found, source: 'found' }
  return { monthlyCents: 0, source: 'none' }
}

function targetOf(input: RetirementInput): Projection['target'] {
  const entered = input.assumptions.targetMonthlyIncomeCents
  if (entered !== null) return { monthlyCents: entered, source: 'entered' }
  const spending = input.recentMonthlySpendingCents
  return spending && spending > 0 ? { monthlyCents: spending, source: 'spending' } : null
}

/**
 * Each pension as it stands for one retirement age: its benefit at the age
 * it starts, and whether it has started by then. `age` is null without a
 * birth year, when only the service so far is counted.
 */
function pensionsAt(
  input: RetirementInput,
  age: number | null,
  retirementAge: number,
): PensionInPlan[] {
  return input.pensions.map((pension) => {
    const startsAge = pension.plan.benefitAge ?? retirementAge
    const benefit = pensionBenefit(pension.plan, age === null ? null : startsAge - age)
    return {
      ...pension,
      payIn: pensionPayIn(pension.plan, input.payCadence),
      benefit,
      startsAge,
      counted: benefit !== null && startsAge <= retirementAge,
    }
  })
}

/** Savings each year from now to a retirement age, ending with the balance then. */
function growthTo(input: RetirementInput, start: StartingSavings, age: number, until: number) {
  const { returnPercent, inflationPercent } = input.assumptions
  const growth = {
    balanceCents: start.totalCents,
    monthlyContributionCents: contributionOf(input).monthlyCents,
    years: until - age,
    returnPercent,
    inflationPercent,
  }
  return growthBand(growth, age)
}

/** Monthly income at a retirement age, from the savings then and the pensions started by then. */
function incomeOf(
  input: RetirementInput,
  savingsAtRetirement: Band,
  pensions: PensionInPlan[],
): RetirementIncome {
  const { withdrawalPercent } = input.assumptions
  const savings = mapBand(savingsAtRetirement, (cents) =>
    Math.round((cents * withdrawalPercent) / 100 / 12),
  )
  const pension = pensions
    .filter((one) => one.counted)
    .reduce((sum, one) => addBands(sum, one.benefit!), ZERO)
  return { pension, savings, total: addBands(pension, savings) }
}

/** The balance at the last point of a band, without its age. */
function finalBand(band: BandPoint[]): Band {
  const { low, mid, high } = band.at(-1)!
  return { low, mid, high }
}

/**
 * The first age up to five years past the planned one whose middle case meets
 * the target, with savings growing and service adding up for the extra years.
 * Offered as one choice the owner can weigh, never as advice to save more.
 */
function laterAgeOf(
  input: RetirementInput,
  start: StartingSavings,
  age: number,
  targetCents: number,
): number | null {
  const { retirementAge } = input.assumptions
  for (let later = retirementAge + 1; later <= retirementAge + LATER_YEARS; later++) {
    const savings = finalBand(growthTo(input, start, age, later))
    const income = incomeOf(input, savings, pensionsAt(input, age, later))
    if (income.total.mid >= targetCents) return later
  }
  return null
}

function projectionOf(input: RetirementInput, pensions: PensionInPlan[], age: number): Projection {
  const { retirementAge, inflationPercent, returnPercent } = input.assumptions
  const startingSavings = startingSavingsOf(input)
  const target = targetOf(input)
  const band = growthTo(input, startingSavings, age, retirementAge)
  const savingsAtRetirement = finalBand(band)
  const income = incomeOf(input, savingsAtRetirement, pensions)
  // A pension with no known benefit could cover the target alone, so no verdict without it.
  const judged = target !== null && pensions.every((pension) => pension.benefit !== null)
  const coverage = judged
    ? mapBand(income.total, (cents) => Math.round((cents / target.monthlyCents) * 100))
    : null
  const short = judged && income.total.mid < target.monthlyCents

  return {
    age,
    retirementAge,
    yearsToGo: Math.max(0, retirementAge - age),
    startingSavings,
    contribution: contributionOf(input),
    target,
    realReturns: mapBand(caseReturns(returnPercent), (r) =>
      oneDecimal(realReturnPercent(r, inflationPercent)),
    ),
    savingsAtRetirement,
    band,
    income,
    coverage,
    onTrack: coverage ? onTrackOf(coverage.mid) : null,
    gapMonthlyCents: judged ? Math.max(0, target.monthlyCents - income.total.mid) : null,
    laterAge: short ? laterAgeOf(input, startingSavings, age, target.monthlyCents) : null,
  }
}

export function retirementPlan(input: RetirementInput): RetirementPlan {
  const { birthYear, retirementAge } = input.assumptions
  const known = birthYear === null ? null : ageIn(input.today, birthYear)
  // An age below zero is a typo, not a projection.
  const age = known !== null && known >= 0 ? known : null
  const pensions = pensionsAt(input, age, retirementAge)
  return {
    projection: age === null ? null : projectionOf(input, pensions, age),
    assumptions: input.assumptions,
    pensions,
    hasPension: pensions.length > 0,
    pensionsWithoutBenefit: pensions.filter((pension) => pension.benefit === null).length,
    note: PROJECTION_NOTE,
  }
}
