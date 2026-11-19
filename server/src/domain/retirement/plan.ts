/**
 * Retirement: the one place Leeway works out whether savings and pensions can
 * pay for the retirement the owner wants. The financial profile holds the
 * result, and the retirement lens, the digest and the summary all read it
 * there. Pure.
 *
 * How the parts fit:
 * - Assumptions come from settings (assumptions.ts). Without a birth year
 *   there is no projection, only a request for one.
 * - Savings are the retirement accounts' balance, grown in today's dollars by
 *   projection.ts as a low, middle and high case, plus the monthly
 *   contribution: the owner's figure, else transfers Leeway found going to
 *   investment and retirement accounts, else nothing.
 * - Income in retirement is each pension's monthly benefit plus what savings
 *   give at the withdrawal rate. A pension with no benefit entered counts as
 *   unknown, and then Leeway does not say whether the owner is on track.
 * - The target is the owner's figure, else their recent monthly spending.
 * - Coaching never treats missing IRA, 401(k) or brokerage contributions as
 *   under-saving when a pension is recorded: a pension is retirement saving.
 */

import type { IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import type { RetirementAssumptions } from './assumptions.js'
import { pensionPayIn, type Pension, type PensionPayIn } from './pensions.js'
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
/** How many years later Leeway looks for a retirement age that closes a gap. */
const LATER_YEARS = 5

export type OnTrack = 'on_track' | 'close' | 'below_target'

/** A pension as a projection counts it. */
export interface PensionInPlan extends Pension {
  payIn: PensionPayIn
  /** Counted in income at the retirement age: it has a benefit that starts by then. */
  counted: boolean
}

export interface RetirementInput {
  today: IsoDate
  assumptions: RetirementAssumptions
  /** The retirement accounts' balance now. */
  balanceCents: number
  /** Monthly transfers found going to investment and retirement accounts, if any. */
  foundMonthlyContributionCents: number | null
  /** Average monthly spending lately, if Leeway has a whole month of it. */
  recentMonthlySpendingCents: number | null
  pensions: Pension[]
  /** The pay cadence Leeway found, for pension contributions per month. */
  payCadence: Cadence | null
}

/** A projection ready to show. */
export interface Projection {
  age: number
  retirementAge: number
  yearsToGo: number
  contribution: { monthlyCents: number; source: 'entered' | 'found' | 'none' }
  target: { monthlyCents: number; source: 'entered' | 'spending' } | null
  /** Yearly returns after inflation, in percent to one decimal. */
  realReturns: Band
  /** Savings at retirement, in cents of today's dollars. */
  savingsAtRetirement: Band
  /** Each year from now to retirement, for the chart. */
  band: BandPoint[]
  /** Monthly income at retirement: pensions counted, and savings at the withdrawal rate. */
  income: { pensionCents: number; savings: Band; total: Band }
  /** Total income as a whole percent of the target; null without a target. */
  coverage: Band | null
  /** Null without a target, or while a recorded pension has no benefit entered. */
  onTrack: OnTrack | null
  /** How much the middle case falls short of the target each month; 0 when it does not. */
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
  /** Whether a pension is recorded; coaching reads this before talking about saving. */
  hasPension: boolean
  /** Recorded pensions whose monthly benefit is not entered yet. */
  pensionsWithoutBenefit: number
  /** One plain line that goes with every projection. */
  note: string
}

export const PROJECTION_NOTE =
  "A projection in today's dollars from the assumptions shown, not a promise of what markets will do."

function onTrackOf(midPercent: number): OnTrack {
  if (midPercent >= ON_TRACK_PERCENT) return 'on_track'
  return midPercent >= CLOSE_PERCENT ? 'close' : 'below_target'
}

/** Rounded to one decimal, for a return shown as a percent. */
const oneDecimal = (value: number) => Math.round(value * 10) / 10

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

/** Savings at a retirement age, in each case. */
function savingsAt(input: RetirementInput, age: number, retirementAge: number, monthly: number) {
  const { returnPercent, inflationPercent } = input.assumptions
  const growth = {
    balanceCents: input.balanceCents,
    monthlyContributionCents: monthly,
    years: retirementAge - age,
    returnPercent,
    inflationPercent,
  }
  return growthBand(growth, age)
}

/** Monthly income from savings at the withdrawal rate. */
function drawdown(savings: Band, withdrawalPercent: number): Band {
  return mapBand(savings, (cents) => Math.round((cents * withdrawalPercent) / 100 / 12))
}

function projectionOf(input: RetirementInput, pensions: PensionInPlan[], age: number): Projection {
  const { retirementAge, withdrawalPercent, inflationPercent, returnPercent } = input.assumptions
  const contribution = contributionOf(input)
  const target = targetOf(input)
  const band = savingsAt(input, age, retirementAge, contribution.monthlyCents)
  const { age: _age, ...savingsAtRetirement } = band.at(-1)!
  const pensionCents = pensions
    .filter((p) => p.counted)
    .reduce((sum, p) => sum + p.monthlyBenefitCents!, 0)
  const savings = drawdown(savingsAtRetirement, withdrawalPercent)
  const total = mapBand(savings, (cents) => cents + pensionCents)
  const coverage =
    target && mapBand(total, (cents) => Math.round((cents / target.monthlyCents) * 100))
  const unknownPension = pensions.some((p) => p.monthlyBenefitCents === null)
  const short = target !== null && total.mid < target.monthlyCents

  return {
    age,
    retirementAge,
    yearsToGo: Math.max(0, retirementAge - age),
    contribution,
    target,
    realReturns: mapBand(caseReturns(returnPercent), (r) =>
      oneDecimal(realReturnPercent(r, inflationPercent)),
    ),
    savingsAtRetirement,
    band,
    income: { pensionCents, savings, total },
    coverage,
    onTrack: coverage && !unknownPension ? onTrackOf(coverage.mid) : null,
    gapMonthlyCents: target ? Math.max(0, target.monthlyCents - total.mid) : null,
    laterAge: short
      ? laterAgeOf(input, age, contribution.monthlyCents, pensionCents, target)
      : null,
  }
}

/**
 * The first age up to five years past the planned one whose middle case meets
 * the target. Offered as a choice the owner can weigh, never as advice to save
 * more.
 */
function laterAgeOf(
  input: RetirementInput,
  age: number,
  monthlyContributionCents: number,
  pensionCents: number,
  target: NonNullable<Projection['target']>,
): number | null {
  const { retirementAge, withdrawalPercent } = input.assumptions
  for (let later = retirementAge + 1; later <= retirementAge + LATER_YEARS; later++) {
    const savings = savingsAt(input, age, later, monthlyContributionCents).at(-1)!
    if (drawdown(savings, withdrawalPercent).mid + pensionCents >= target.monthlyCents) return later
  }
  return null
}

/** The owner's age this calendar year: a year early before their birthday, which a projection can bear. */
export function ageIn(today: IsoDate, birthYear: number): number {
  return Number(today.slice(0, 4)) - birthYear
}

export function retirementPlan(input: RetirementInput): RetirementPlan {
  const { birthYear, retirementAge } = input.assumptions
  const pensions = input.pensions.map<PensionInPlan>((pension) => ({
    ...pension,
    payIn: pensionPayIn(pension, input.payCadence),
    counted:
      pension.monthlyBenefitCents !== null &&
      (pension.benefitAge ?? retirementAge) <= retirementAge,
  }))
  const age = birthYear === null ? null : ageIn(input.today, birthYear)
  return {
    // An age below zero is a typo, not a projection.
    projection: age === null || age < 0 ? null : projectionOf(input, pensions, age),
    assumptions: input.assumptions,
    pensions,
    hasPension: pensions.length > 0,
    pensionsWithoutBenefit: pensions.filter((p) => p.monthlyBenefitCents === null).length,
    note: PROJECTION_NOTE,
  }
}
