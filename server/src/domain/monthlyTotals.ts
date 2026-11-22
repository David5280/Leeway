// Money in and out for each calendar month, whatever the budget period is.
// The month-by-month charts (income against spending, the savings rate and
// spending by category) read these, and so can an agent. Transfers between
// the owner's own accounts count as neither, as everywhere else. The date the
// bank history starts comes with them: a month that began before it holds
// only part of the month, so it is never judged or averaged as a whole one.
//
// A transaction with no category yet (unfiled) counts this way:
// - two legs that pair as one move between the owner's own accounts (same
//   amount, opposite sign, two accounts, within days) count as neither, when
//   one is unfiled and the other unfiled or filed as a transfer (see
//   unfiledLeg for which lines may pair);
// - any other unfiled purchase counts as money out, so an unfiled deposit
//   never lowers spending or makes it negative (the budget still nets them,
//   as sumTotals does);
// - any other unfiled deposit counts as money in, but in unfiledInCents, not
//   incomeCents: pay is filed income only, so the savings rate agrees with
//   the check-in, the profile and the agent. An unfiled refund lands here
//   too, as money in, rather than lowering money out: matching it to a past
//   purchase would be a guess, and counting it here counts it once.

import type { Db } from '../db/pool.js'
import { addDays, addMonths, dateParts, makeDate, type IsoDate } from '../lib/dates.js'
import {
  categoryTotalsByRange,
  IN_RANGES_SQL,
  currentPeriod,
  rangeParams,
  sumTotals,
  type DateRange,
} from './budgetReport.js'
import type { CategoryTotal } from './budget.js'
import { listCategories } from './categories.js'
import { firstTransactionDay } from './profile/income.js'
import type { Settings } from './settings.js'
import {
  filedOrUnfiledLeg,
  PAIR_WINDOW_DAYS,
  pairTransfers,
  type PairCandidate,
} from './transferPairs.js'

export interface MonthTotals {
  /** First day of the month. */
  start: IsoDate
  /** Last day of the month (inclusive). */
  end: IsoDate
  /** The month still running, so its totals are only so far. */
  current: boolean
  /** Filed spending plus unfiled money out. */
  spentCents: number
  /** Filed income only: the pay the savings rate divides by. */
  incomeCents: number
  /** Unfiled money in that is not one side of a move between own accounts. */
  unfiledInCents: number
  /** Net amount per category; income categories are negative (money in). */
  categories: { categoryId: string | null; amountCents: number }[]
}

export interface MonthlyTotals {
  /** The earliest transaction held, or null before there is any. */
  firstTransactionDate: IsoDate | null
  /** Oldest first, ending with the month still running. */
  months: MonthTotals[]
}

/**
 * The months the bank history covers from their first day, and the one still
 * running: a month that began before the first transaction holds only part
 * of its money, so it would read as a low month.
 */
export function wholeMonths({ firstTransactionDate: first, months }: MonthlyTotals): MonthTotals[] {
  return months.filter((month) => month.current || first === null || month.start >= first)
}

/** The first day of each of the last `count` months, oldest first, ending with today's. */
export function monthStarts(today: IsoDate, count: number): IsoDate[] {
  const { year, month } = dateParts(today)
  const thisMonth = makeDate(year, month, 1)
  return Array.from({ length: count }, (_, i) => addMonths(thisMonth, i - count + 1))
}

/** Totals for the last `count` calendar months, oldest first, ending with this one, and where the history starts. */
export async function monthlyTotals(
  db: Db,
  settings: Settings,
  now: Date,
  count: number,
): Promise<MonthlyTotals> {
  const { today } = currentPeriod(settings, now)
  const starts = monthStarts(today, count)
  const ranges = starts.map((start) => ({ start, end: addMonths(start, 1) }))
  // One at a time: db may be a transaction's client, which runs one query at once.
  const categories = await listCategories(db)
  const totalsByMonth = await categoryTotalsByRange(db, ranges, settings.includePending)
  const unfiled = await unfiledFlows(db, ranges, settings.includePending)
  const firstTransactionDate = await firstTransactionDay(db)
  const months = ranges.map((range, i) => {
    const totals = totalsByMonth[i]!
    return {
      start: range.start,
      end: addDays(range.end, -1),
      current: i === ranges.length - 1,
      ...flowTotals(sumTotals(categories, totals), totals, unfiled[i]!),
      categories: totals.map(({ categoryId, amountCents }) => ({ categoryId, amountCents })),
    }
  })
  return { firstTransactionDate, months }
}

/** Money out and money in with no category yet, in one range. */
interface Flows {
  outCents: number
  inCents: number
}

/** An unfiled transaction, or a filed transfer leg read only so its other side can pair. */
type FlowLeg = PairCandidate & { filedTransfer: boolean }

/**
 * The unfiled transactions of each range, split by sign, in the ranges'
 * order, less the legs that pair as moves between own accounts. Legs filed
 * as transfers are read too, never counted, so an unfiled leg whose other
 * side is filed still pairs. Legs up to two pairing windows either side are
 * read, so a leg just past the edge pairs the same way whatever the months
 * asked for: its own partner may lie a window further out.
 */
async function unfiledFlows(
  db: Db,
  ranges: DateRange[],
  includePending: boolean,
): Promise<Flows[]> {
  const margin = 2 * PAIR_WINDOW_DAYS
  const span = {
    start: addDays(ranges[0]!.start, -margin),
    end: addDays(ranges[ranges.length - 1]!.end, margin),
  }
  const { rows } = await db.query<FlowLeg>(
    `SELECT t.id, t.account_id AS "accountId", t.date, t.name, t.merchant_name AS "merchantName",
       t.amount_cents AS "amountCents", t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType",
       t.category_id IS NOT NULL AS "filedTransfer"
     ${IN_RANGES_SQL}
       AND (t.category_id IS NULL OR c.kind = 'transfer')`,
    rangeParams([span], includePending),
  )
  // The owner filed a transfer leg as one, so it may pair whatever its line says.
  const paired = pairTransfers(
    rows,
    filedOrUnfiledLeg((tx) => tx.filedTransfer),
  )
  const flows = ranges.map((): Flows => ({ outCents: 0, inCents: 0 }))
  for (const tx of rows) {
    const i = ranges.findIndex((range) => tx.date >= range.start && tx.date < range.end)
    // Outside every month (read only to pair), filed as a transfer, or one side of an own move.
    if (i < 0 || tx.filedTransfer || paired.has(tx.id)) continue
    if (tx.amountCents > 0) flows[i]!.outCents += tx.amountCents
    else flows[i]!.inCents -= tx.amountCents
  }
  return flows
}

/**
 * Spending and income for a month: the budget's sums, with the unfiled
 * bucket (which the budget nets into spending) taken back out. Unfiled money
 * out goes back into spending; unfiled money in stays apart from income.
 */
function flowTotals(
  budget: { spentCents: number; incomeCents: number },
  totals: CategoryTotal[],
  { outCents, inCents }: Flows,
): { spentCents: number; incomeCents: number; unfiledInCents: number } {
  const netUnfiled = totals.find((total) => total.categoryId === null)?.amountCents ?? 0
  return {
    spentCents: budget.spentCents - netUnfiled + outCents,
    incomeCents: budget.incomeCents,
    unfiledInCents: inCents,
  }
}
