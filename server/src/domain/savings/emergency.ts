// The emergency fund: how many months of essential spending it covers (what
// its goal holds, or the savings accounts before there is one; see
// emergencyPlan.ts), against the target the owner set, and when the current
// pace of saving gets there. Pure.

import { addMonths, type IsoDate } from '../../lib/dates.js'

/** The usual advice is three to six months; Leeway aims for the top of that unless told otherwise. */
export const DEFAULT_EMERGENCY_MONTHS = 6
/** Below this many months the fund is called low. */
export const LOW_EMERGENCY_MONTHS = 3
/** A pace that takes longer than this is no forecast, so no date is given. */
const MAX_FORECAST_MONTHS = 600

export type EmergencyStatus = 'met' | 'building' | 'low'
export type EssentialsSource = 'spending' | 'bills'

export interface EmergencyFund {
  /** Cash savings counted toward the fund. */
  savedCents: number
  /** Essential spending in an average month. */
  monthlyEssentialsCents: number
  /** Where that figure came from: recent spending, or the bills when spending is too new to say. */
  essentialsFrom: EssentialsSource
  /** Months of essentials the savings cover, to one decimal. */
  monthsCovered: number
  targetMonths: number
  targetCents: number
  /** What is still needed to reach the target; 0 once it is met. */
  shortCents: number
  status: EmergencyStatus
  /** Money moving into savings each month lately, or null when none was seen. */
  monthlyPaceCents: number | null
  /** The month the pace reaches the target (its first day), or null when it will not. */
  reachesTargetOn: IsoDate | null
}

/** What essential spending a month comes to, and how Leeway knows. */
export interface EssentialsMeasure {
  cents: number
  from: EssentialsSource
}

/**
 * Essential spending in a typical month: recent whole months of spending when
 * they show any, otherwise the tracked bills, the best measure before a whole
 * month is held (or when no spending reads as essential). Null when neither
 * says, since a fund of zero months would mean nothing. The emergency fund's
 * card and the financial profile both size the fund by this one rule.
 */
export function essentialsFrom(
  essentialSpendingCents: number | null,
  billsMonthlyCents: number,
): EssentialsMeasure | null {
  if (essentialSpendingCents !== null && essentialSpendingCents > 0) {
    return { cents: essentialSpendingCents, from: 'spending' }
  }
  return billsMonthlyCents > 0 ? { cents: billsMonthlyCents, from: 'bills' } : null
}

/** Months of essentials some savings cover, to one decimal, rounded down so it never says more. */
export function monthsCovered(savedCents: number, monthlyEssentialsCents: number): number {
  return Math.floor((Math.max(0, savedCents) / monthlyEssentialsCents) * 10) / 10
}

/**
 * The fund's standing. Null when essential spending is unknown or zero: with
 * nothing to cover, "months covered" would mean nothing.
 */
export function emergencyFund(input: {
  savedCents: number
  monthlyEssentialsCents: number | null
  essentialsFrom: EssentialsSource
  targetMonths: number
  monthlyPaceCents: number | null
  today: IsoDate
}): EmergencyFund | null {
  const { savedCents, monthlyEssentialsCents: essentials, targetMonths, today } = input
  if (essentials === null || essentials <= 0) return null
  const saved = Math.max(0, savedCents)
  const targetCents = essentials * targetMonths
  const shortCents = Math.max(0, targetCents - saved)
  const covered = monthsCovered(saved, essentials)
  const pace =
    input.monthlyPaceCents !== null && input.monthlyPaceCents > 0 ? input.monthlyPaceCents : null
  return {
    savedCents: saved,
    monthlyEssentialsCents: essentials,
    essentialsFrom: input.essentialsFrom,
    monthsCovered: covered,
    targetMonths,
    targetCents,
    shortCents,
    status: statusOf(shortCents, covered),
    monthlyPaceCents: input.monthlyPaceCents,
    reachesTargetOn: reachDate(shortCents, pace, today),
  }
}

function statusOf(shortCents: number, monthsCovered: number): EmergencyStatus {
  if (shortCents === 0) return 'met'
  return monthsCovered < LOW_EMERGENCY_MONTHS ? 'low' : 'building'
}

/** The first of the month the pace closes the gap; null when met, with no pace, or too far off. */
function reachDate(shortCents: number, pace: number | null, today: IsoDate): IsoDate | null {
  if (shortCents === 0 || pace === null) return null
  const months = Math.ceil(shortCents / pace)
  if (months > MAX_FORECAST_MONTHS) return null
  return addMonths(today, months, 1)
}
