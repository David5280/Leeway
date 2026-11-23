// A short run's one paycheck off the cycle, found before its gap is read. Pure.
//
// offCycle.ts sets a bonus aside by its gap against the run's middle one.
// In a long run a bonus splits one gap of many, but in a run of three or
// four it splits enough to become the middle: a biweekly run with a bonus
// between paydays reads as weekly, a monthly one with a bonus mid-month as
// twice a month. So the gap is read without the paycheck that explains it:
// - Of four, by timing alone, as offCycle.ts reads paychecks: the one
//   between the ends whose removal leaves gaps that all fit one longer
//   cadence. Weekly pay with a week missed reads the same, as the later
//   next payday, the cautious reading.
// - Of three, timing cannot tell a bonus midway from a payday, so the amount
//   does: the middle one, when the ends pay about alike and it pays clearly
//   apart, by more than half their pay. Hourly pay swinging that far in its
//   middle week reads every two weeks: cautious too.
// Longer runs read right by their gaps alone, and are left to them.

import { daysBetween } from '../../lib/dates.js'
import { CYCLE_DAYS, gapCadence, roughCadence, type PayCadence } from './cadence.js'
import type { Paycheck } from './paychecks.js'

/** How far apart the middle paycheck of three must pay, as a share of the ends', to be off. */
export const CLEAR_STRAY_SHARE = 0.5

/** How many times the ends' own difference the middle must stray, so ends that differ say nothing. */
const ENDS_SPREAD_TIMES = 2

/** Whether `found` is a longer cadence than `rough`, a run that fits none counting as shortest. */
const longer = (found: PayCadence, rough: PayCadence | null) =>
  rough === null || CYCLE_DAYS[found] > CYCLE_DAYS[rough]

/** The one cadence every gap between these paychecks fits, or null when they fit none or several. */
function sharedCadence(paychecks: Paycheck[]): PayCadence | null {
  const cadences = paychecks
    .slice(1)
    .map((paycheck, i) => gapCadence(daysBetween(paychecks[i]!.date, paycheck.date)))
  const first = cadences[0] ?? null
  return cadences.every((cadence) => cadence === first) ? first : null
}

/** Whether the middle of three pays clearly apart from two ends that pay about alike. */
function middleStrays([first, middle, last]: Paycheck[]): boolean {
  const endsCents = (first!.amountCents + last!.amountCents) / 2
  const stray = Math.abs(middle!.amountCents - endsCents)
  const endsSpread = Math.abs(first!.amountCents - last!.amountCents)
  return stray > CLEAR_STRAY_SHARE * endsCents && stray > ENDS_SPREAD_TIMES * endsSpread
}

/** The paychecks left without the one at `index`. */
const without = (paychecks: Paycheck[], index: number) => paychecks.filter((_, i) => i !== index)

/**
 * The paychecks of a short run (oldest first) to read its gap from: all but
 * the one off the cycle that lowers its middle gap, or null when none does
 * or the run is not short.
 */
export function shortRunPaydays(paychecks: Paycheck[]): Paycheck[] | null {
  if (paychecks.length < 3 || paychecks.length > 4) return null
  const rough = roughCadence(paychecks.map((paycheck) => paycheck.date))
  const fits = (rest: Paycheck[]) => {
    const found = sharedCadence(rest)
    return found !== null && longer(found, rough)
  }
  if (paychecks.length === 3) {
    const ends = without(paychecks, 1)
    return middleStrays(paychecks) && fits(ends) ? ends : null
  }
  // Of four, at most one is longer: were both to fit, the middle gap would already fit theirs.
  const rests = [1, 2].map((index) => without(paychecks, index))
  return rests.find(fits) ?? null
}
