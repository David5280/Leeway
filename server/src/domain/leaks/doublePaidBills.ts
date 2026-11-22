// One charge, one alert. A tracked bill paid twice in a cycle is both a bill
// change (the cycle cost double, billChanges.ts) and a charge made twice
// (duplicates.ts): two alerts and two pushes for one mistake. "Charged
// twice?" says what happened, so the bill's change for that cycle is left
// out, and when the price changed too, the change is told at what the cycle
// cost paid once. Pure.
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
import { isAmountChange } from '../billAmountChange.js'
import type { BillChange, ChangedBill } from '../billChanges.js'
import { paidOnceCents, withoutRepeats } from '../billCycles.js'
import { DUPLICATE_NEWS_DAYS, type DuplicateCharge } from './duplicates.js'

/**
 * Whether a changed cycle was paid twice: it holds a charge repeated within
 * DUPLICATE_DAYS, and without the repeats it costs the bill's usual amount
 * again. A bill whose price also went up is still a change, as both are news.
 */
export function wasPaidTwice({ bill, cycle }: ChangedBill): boolean {
  const repeated = withoutRepeats(cycle).length < cycle.length
  return repeated && !isAmountChange(bill.amountCents, paidOnceCents(cycle))
}

/**
 * Whether "Charged twice?" shows the cycle: one of its repeats is the latest
 * charge of a double charge, on the same account, day and amount.
 */
function toldAsDouble({ cycle }: ChangedBill, doubles: DuplicateCharge[]): boolean {
  const kept = withoutRepeats(cycle)
  const repeats = cycle.filter((charge) => !kept.includes(charge))
  return repeats.some((repeat) =>
    doubles.some(({ accountId, charges }) => {
      const last = charges.at(-1)!
      return (
        accountId === repeat.accountId &&
        last.date === repeat.date &&
        last.amountCents === repeat.amountCents
      )
    }),
  )
}

/** The change as the cycle cost paid once: the repeats left out of its charges and its total. */
function paidOnce(change: ChangedBill): ChangedBill {
  const cycle = withoutRepeats(change.cycle)
  return { ...change, cycle, charge: { ...change.charge, amountCents: paidOnceCents(cycle) } }
}

/**
 * The bill changes, less the cycles paid twice that "Charged twice?" tells
 * or told. `doubles` are every double charge still news, refunded ones too: a
 * refund nets the money back, but the cycle's total still counts both
 * charges, so its change would be no news either. A cycle whose price
 * changed as well stays, at what it cost paid once when "Charged twice?"
 * tells the extra charge, so the double is not said twice.
 */
export function withoutDoublePaid(
  changes: BillChange[],
  doubles: DuplicateCharge[],
  today: IsoDate,
): BillChange[] {
  return changes.flatMap((change): BillChange[] => {
    if (change.kind !== 'changed') return [change]
    const told = toldAsDouble(change, doubles)
    if (!wasPaidTwice(change)) return [told ? paidOnce(change) : change]
    // The same span findDoubleCharges keeps a double charge as news.
    const stillNews = daysBetween(change.charge.date, today) < DUPLICATE_NEWS_DAYS
    return stillNews && !told ? [change] : []
  })
}
