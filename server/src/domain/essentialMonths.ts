// Essential spending over stretches of time, read from stored data: the one
// reading the emergency fund (monthlyEssentials.ts) and the financial
// profile (profile/income.ts) both go by, so the two never disagree.
//
// Essentials from categories, picked by the owner or found by Leeway, leave
// out every credit card payment line, either side (the skipAll rule in
// categoryTotals.ts): a payment says nothing of which purchases it paid
// for, so none of it is known to be essential. When nothing reads as
// essential and all spending counts instead, spending is read as a typical
// month reads it (spendingByRange in monthlyTotals.ts), where a payment to a
// card Leeway cannot see counts as the spending it stands for: an owner who
// pays mostly with an untracked card must not get a shrunken fund target.

import type { Db } from '../db/pool.js'
import type { Category } from './categories.js'
import { categoryTotalsByRange, type DateRange } from './categoryTotals.js'
import { essentialCodedByRange } from './essentialCoded.js'
import { essentialSpending, type MonthSpending } from './essentialSpending.js'
import { spendingByRange } from './monthlyTotals.js'

/** One stretch's spending, as essentials are counted from it. */
export interface EssentialMonth extends MonthSpending {
  /** The stretch's spending as a typical month counts it: what all spending counting comes to. */
  spentCents: number
}

/** Each range's spending, in the ranges' order, posted only (a stretch already over has settled). */
export async function readEssentialMonths(db: Db, ranges: DateRange[]): Promise<EssentialMonth[]> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const totalsByRange = await categoryTotalsByRange(db, ranges, false, null, {
    cardPayments: 'skipAll',
  })
  const codedByRange = await essentialCodedByRange(db, ranges)
  const spending = await spendingByRange(db, ranges)
  return totalsByRange.map((totals, at) => ({
    totals,
    essentialCoded: codedByRange[at]!,
    spentCents: spending[at]!.spentCents,
  }))
}

/** Essential spending in one stretch, for the categories and the owner's pick (essentialSpending.ts). */
export function essentialCentsOf(
  categories: Category[],
  month: EssentialMonth,
  essentialIds: string[] | null,
): number {
  return essentialSpending(categories, month, essentialIds, month.spentCents)
}
