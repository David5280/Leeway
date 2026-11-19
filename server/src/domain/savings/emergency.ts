// The emergency fund: how many months of essential spending the owner's cash
// savings would cover, against the target they set, and when the current
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
  // Rounded down, so the fund is never said to cover more than it does.
  const monthsCovered = Math.floor((saved / essentials) * 10) / 10
  const pace =
    input.monthlyPaceCents !== null && input.monthlyPaceCents > 0 ? input.monthlyPaceCents : null
  return {
    savedCents: saved,
    monthlyEssentialsCents: essentials,
    essentialsFrom: input.essentialsFrom,
    monthsCovered,
    targetMonths,
    targetCents,
    shortCents,
    status: statusOf(shortCents, monthsCovered),
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
