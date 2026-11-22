// One charge, one alert. A tracked bill paid twice in a cycle is both a bill
// change (the cycle cost double, billChanges.ts) and a charge made twice
// (duplicates.ts): two alerts and two pushes for one mistake. "Charged
// twice?" says what happened, so the bill's change for that cycle is left
// out. Pure.
//
// The two are news for different spans: a charge made twice for about a
// statement, a monthly bill's change for a cycle and a half. So the cycle is
// judged by its own charges, and "Charged twice?" is only asked whether it is
// showing while the double charge is still news:
// - still news, and "Charged twice?" shows it (refunded or not): left out;
// - still news, but read as routine there, so no "Charged twice?": the bill's
//   change shows, so the owner always hears of it once;
// - no longer news: left out, so an old mistake never comes back as a change.

import { daysBetween, type IsoDate } from '../../lib/dates.js'
import { isAmountChange, type BillChange, type BillCharge } from '../billChanges.js'
import { DUPLICATE_DAYS, DUPLICATE_NEWS_DAYS, type DuplicateCharge } from './duplicates.js'

type Changed = Extract<BillChange, { kind: 'changed' }>

/**
 * A cycle's charges (newest first) less the repeats: each charge of the same
 * amount on the same account within DUPLICATE_DAYS of an older one kept.
 */
function withoutRepeats(cycle: BillCharge[]): BillCharge[] {
  const kept: BillCharge[] = []
  // Oldest first, so the first of each run is the one kept.
  for (const charge of [...cycle].reverse()) {
    const repeats = kept.some(
      (one) =>
        one.accountId === charge.accountId &&
        one.amountCents === charge.amountCents &&
        daysBetween(one.date, charge.date) <= DUPLICATE_DAYS,
    )
    if (!repeats) kept.push(charge)
  }
  return kept
}

/**
 * Whether a changed cycle was paid twice: it holds a charge repeated within
 * DUPLICATE_DAYS, and without the repeats it costs the bill's usual amount
 * again. A bill whose price also went up is still a change, as both are news.
 */
export function wasPaidTwice({ bill, cycle }: Changed): boolean {
  const kept = withoutRepeats(cycle)
  const keptCents = kept.reduce((sum, charge) => sum + charge.amountCents, 0)
  return kept.length < cycle.length && !isAmountChange(bill.amountCents, keptCents)
}

/** Whether "Charged twice?" shows the cycle: a double charge on its account ending on its latest charge. */
const toldAsDouble = ({ charge }: Changed, doubles: DuplicateCharge[]) =>
  doubles.some(
    ({ accountId, charges }) =>
      accountId === charge.accountId && charges.at(-1)!.date === charge.date,
  )

/**
 * The bill changes, less the cycles paid twice that "Charged twice?" tells
 * or told. `doubles` are every double charge still news, refunded ones too: a
 * refund nets the money back, but the cycle's total still counts both
 * charges, so its change would be no news either.
 */
export function withoutDoublePaid(
  changes: BillChange[],
  doubles: DuplicateCharge[],
  today: IsoDate,
): BillChange[] {
  return changes.filter((change) => {
    if (change.kind !== 'changed' || !wasPaidTwice(change)) return true
    // The same span findDoubleCharges keeps a double charge as news.
    const stillNews = daysBetween(change.charge.date, today) < DUPLICATE_NEWS_DAYS
    return stillNews && !toldAsDouble(change, doubles)
  })
}
