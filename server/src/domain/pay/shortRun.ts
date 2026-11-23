// A short run's one paycheck off the cycle, found before its gap is read. Pure.
//
// offCycle.ts sets a bonus aside by its gap against the run's middle one.
// In a long run a bonus splits one gap of many, but in a run of three or
// four it splits enough to become the middle: a biweekly run with a bonus
// between paydays reads as weekly, a monthly one with a bonus mid-month as
// twice a month. So such a run's gap is read without the paycheck that
// lowers it, but only where timing and amount both set it apart, since a
// run this short reads right by its gaps far more often than not:
// - Of three, timing cannot tell a bonus midway from a payday, so the rule
//   only lengthens weekly to every two weeks: ends about two weeks apart,
//   the middle about a week from each and paying clearly apart from them.
// - Of four, the paycheck between the ends whose removal leaves gaps that
//   all fit one longer cadence, when it pays clearly apart from the three
//   kept. Equal paychecks with a payday missed stay as their gaps read.
// A cadence the owner gave must agree with the longer one, and settles it;
// without one, the reading is an estimate until a fifth paycheck. Longer
// runs read right by their gaps alone, and are left to them.
//
// Accepted trade-offs:
// - Hourly pay whose middle week of three swings far from the weeks either
//   side reads every two weeks: the later next payday, the cautious side.
// - Three paychecks never read as monthly: Oct 1, a bonus Oct 15, Nov 2
//   looks just like a 1st and 15th payroll with a short payday, so it reads
//   as one, as it did before this rule.
// - Of four, a bonus paying the usual amount beside a short payday is not
//   told apart by amount, so the run reads as its gaps say until a fifth.

import { daysBetween } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { CYCLE_DAYS, gapCadence, roughCadence, type PayCadence } from './cadence.js'
import type { Paycheck } from './paychecks.js'

/** How far apart a paycheck must pay, as a share of the kept ones' usual pay, to be off. */
const CLEAR_STRAY_SHARE = 0.5

/** Times the kept paychecks' own spread it must stray, so kept pay that swings says nothing. */
const KEPT_SPREAD_TIMES = 2

/** Whether `found` is a longer cadence than `rough`, a run that fits none counting as shortest. */
const longer = (found: PayCadence, rough: PayCadence | null) =>
  rough === null || CYCLE_DAYS[found] > CYCLE_DAYS[rough]

/** The one cadence every gap between these paychecks fits, or null when they fit none or several. */
function sharedCadence(paychecks: Paycheck[]): PayCadence | null {
  const cadences = paychecks
    .slice(1)
    .map((paycheck, i) => gapCadence(daysBetween(paychecks[i]!.date, paycheck.date)))
  // Never empty: every run read here keeps at least two paychecks.
  return cadences.every((cadence) => cadence === cadences[0]) ? cadences[0]! : null
}

/** Whether `paycheck` pays clearly apart from `kept`, by more than half and more than they swing. */
function paysApart(paycheck: Paycheck, kept: Paycheck[]): boolean {
  const amounts = kept.map((each) => each.amountCents)
  const usual = amounts.reduce((sum, cents) => sum + cents, 0) / amounts.length
  const stray = Math.abs(paycheck.amountCents - usual)
  const spread = Math.max(...amounts) - Math.min(...amounts)
  return stray > CLEAR_STRAY_SHARE * usual && stray > KEPT_SPREAD_TIMES * spread
}

/** The paychecks left without the one at `index`. */
const without = (paychecks: Paycheck[], index: number) => paychecks.filter((_, i) => i !== index)

/** Whether a longer cadence read from a short run agrees with the one the owner gave, if any. */
const agreesWith = (found: PayCadence, given: Cadence | null) =>
  given === null || gapCadence(CYCLE_DAYS[given]) === found

/**
 * The paychecks of a short run (oldest first) to read its gap from: all but
 * the one off the cycle that lowers its middle gap, or null when none does
 * or the run is not short. `given` is a cadence the owner gave.
 */
export function shortRunPaydays(
  paychecks: Paycheck[],
  given: Cadence | null = null,
): Paycheck[] | null {
  if (paychecks.length < 3 || paychecks.length > 4) return null
  const rough = roughCadence(paychecks.map((paycheck) => paycheck.date))
  // The run without the paycheck at `index`, when timing and amount both set that one off.
  const restWithout = (index: number) => {
    const rest = without(paychecks, index)
    const found = sharedCadence(rest)
    const fits = found !== null && longer(found, rough) && agreesWith(found, given)
    return fits && paysApart(paychecks[index]!, rest) ? rest : null
  }
  if (paychecks.length === 3) {
    // Weekly halves leave ends about two weeks apart: the one lengthening three can show.
    return sharedCadence(paychecks) === 'week' ? restWithout(1) : null
  }
  // Of four, at most one is longer: were both to fit, the middle gap would already fit theirs.
  return restWithout(1) ?? restWithout(2)
}
