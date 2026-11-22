// How far apart a repeating charge's charges may fall for each cadence: what
// the recurring finder (recurring.ts) detects a series by, and what a price
// rise (leaks/priceRises.ts) checks the latest charge's timing against.
// Pure, with no database behind it, so the web app can bundle what imports it.

import type { Cadence } from '../lib/periods.js'

/** A cadence's band: the gaps in days it allows, and the charges a series needs to be found. */
export interface CadenceBand {
  cadence: Cadence
  min: number
  max: number
  minCount: number
}

/**
 * The gap in days each cadence allows between two charges. Banks post a day
 * or two late and months differ in length, so each band has some slack. The
 * bands do not overlap.
 */
export const CADENCE_BANDS: readonly CadenceBand[] = [
  { cadence: 'week', min: 6, max: 8, minCount: 4 },
  { cadence: 'biweek', min: 12, max: 16, minCount: 3 },
  { cadence: 'month', min: 27, max: 33, minCount: 3 },
  { cadence: 'quarter', min: 85, max: 97, minCount: 2 },
  { cadence: 'year', min: 355, max: 375, minCount: 2 },
]

/**
 * Whether a gap in days between two charges fits a cadence, with the same
 * slack detection allows. A cadence detection never finds (semimonth) fits none.
 */
export function fitsCadence(gapDays: number, cadence: Cadence): boolean {
  const band = CADENCE_BANDS.find((one) => one.cadence === cadence)
  return band !== undefined && gapDays >= band.min && gapDays <= band.max
}
