// The owner's typical month: pay in from the current employer, spending out
// over the same recent stretch, and how often pay comes. Every number built
// on income (the profile, the savings rate, the check-in, the AI's summary,
// can-I-afford) reads it through typicalMonth, so none works out its own.
//
// Why it was wrong before: typical income was every deposit filed under an
// income category, averaged over the last three calendar months. After a job
// ended, those months held money family sent through Venmo or Zelle (filed
// as "Received from people"), a tax refund and a lump moved in from another
// bank, so they read as about $1,200 of pay a month, and spending was
// averaged over months shaped by the old job and the gap. Now pay is
// paychecks only (pay/current.ts), from the current employer's first
// paycheck on, and spending is measured over the same recent stretch.

import type { Db } from '../../db/pool.js'
import { addDays, daysBetween, maxDate, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { accountMasks } from '../accounts.js'
import type { CategoryTotal } from '../budget.js'
import { listCategories, type Category } from '../categories.js'
import { firstTransactionDay, spendingByRange } from '../monthlyTotals.js'
import type { CurrentPay } from '../pay/current.js'
import { readCurrentPay } from '../pay/source.js'
import { paydayFrom, type PaydaySource } from '../pay/payday.js'
import type { Settings } from '../settings.js'
import { merchantDisplayName } from '../transactionName.js'

/** About how many days a month has. */
const DAYS_PER_MONTH = 365.25 / 12

/** The longest stretch typical spending looks back over: about three months. */
export const SPENDING_MAX_DAYS = 91

/**
 * The shortest: eight weeks back, even when the job started a week ago, so
 * a month or two of spending is always behind the figure.
 */
export const SPENDING_MIN_DAYS = 56

/** Less bank history than this is too little to call any month typical. */
export const SPENDING_LEAST_DAYS = 28

export interface PaySchedule {
  /** How often pay comes; null when no employer is paying now. */
  cadence: Cadence | null
  /** Where the schedule came from; null when nothing gave one. */
  source: Exclude<PaydaySource, 'period_end'> | null
  /** A usual paycheck from the current employer. */
  typicalPayCents: number | null
  nextPayday: IsoDate | null
  /** True while one paycheck is all there is: the cadence, and so the month, are a projection. */
  estimate: boolean
  /** The current employer, named as the app names its deposits, or null. */
  employer: string | null
  /** The current employer's first paycheck: where typical income starts. */
  since: IsoDate | null
}

export interface MonthlyAverages {
  /** A month of pay from the current employer, take-home; null when no employer is paying now. */
  incomeCents: number | null
  /** True while the pay above is projected from a single paycheck. */
  incomeEstimated: boolean
  /** Spending a month, transfers and card payments left out; null with too little history. */
  spendingCents: number | null
  /** Spending in the categories the owner counts as essential (all spending by default). */
  essentialSpendingCents: number | null
  /** The first day spending was measured from, or null with too little history. */
  spendingSince: IsoDate | null
  /** The days spending was measured over, up to yesterday; 0 with too little history. */
  spendingDays: number
}

/** The typical month and the pay it is built on, read once for every number that needs them. */
export interface TypicalMonth {
  pay: PaySchedule
  monthly: MonthlyAverages
  /** The paychecks themselves, for pay month by month (savings rates). */
  currentPay: CurrentPay
}

/**
 * The stretch typical spending is measured over, up to yesterday: from the
 * current employer's first paycheck, kept between SPENDING_MIN_DAYS and
 * SPENDING_MAX_DAYS, and never before the bank history starts. Null when that
 * leaves less than SPENDING_LEAST_DAYS.
 */
export function spendingWindow(
  today: IsoDate,
  employerSince: IsoDate | null,
  firstDataDay: IsoDate | null,
): { start: IsoDate; days: number } | null {
  if (firstDataDay === null) return null
  const wanted = employerSince === null ? SPENDING_MAX_DAYS : daysBetween(employerSince, today)
  const days = Math.min(SPENDING_MAX_DAYS, Math.max(SPENDING_MIN_DAYS, wanted))
  const start = maxDate(addDays(today, -days), firstDataDay)
  const held = daysBetween(start, today)
  return held < SPENDING_LEAST_DAYS ? null : { start, days: held }
}

/**
 * The essential categories the owner picked that still exist as spending
 * categories, or null for every spending category. Settings can hold ids of
 * categories since deleted or replaced, so only current ones count, and a
 * pick with none left counts all spending rather than none.
 */
export function currentEssentials(
  categories: Category[],
  essentialIds: string[] | null,
): Set<string> | null {
  if (essentialIds === null) return null
  const picked = new Set(essentialIds)
  const current = categories.filter((c) => c.kind === 'expense' && picked.has(c.id))
  return current.length ? new Set(current.map((c) => c.id)) : null
}

/** Spending in the essential categories, or all of `spentCents` when none are picked. */
export function essentialSpending(
  categories: Category[],
  totals: CategoryTotal[],
  essentialIds: string[] | null,
  spentCents: number,
): number {
  const essentials = currentEssentials(categories, essentialIds)
  if (essentials === null) return spentCents
  return totals
    .filter((total) => total.categoryId !== null && essentials.has(total.categoryId))
    .reduce((sum, total) => sum + total.amountCents, 0)
}

/** Spending a month over the window, and its essential share. */
async function monthlySpending(
  db: Db,
  settings: Settings,
  window: { start: IsoDate; days: number } | null,
  today: IsoDate,
) {
  if (window === null) return { spendingCents: null, essentialSpendingCents: null }
  const [spending] = await spendingByRange(db, [{ start: window.start, end: today }])
  const categories = await listCategories(db)
  const ids = settings.savingsPlan.essentialCategoryIds
  const essential = essentialSpending(categories, spending!.totals, ids, spending!.spentCents)
  const perMonth = (cents: number) => Math.round((cents * DAYS_PER_MONTH) / window.days)
  return {
    spendingCents: perMonth(spending!.spentCents),
    essentialSpendingCents: perMonth(essential),
  }
}

/** How often pay comes and when next, as the profile and an agent read it. */
async function payScheduleOf(
  db: Db,
  pay: CurrentPay,
  settings: Settings,
  today: IsoDate,
): Promise<PaySchedule> {
  const payday = paydayFrom(pay, settings, today)
  const employer = pay.employer
  return {
    cadence: payday.source === 'period_end' ? null : payday.cadence,
    source: payday.source === 'period_end' ? null : payday.source,
    typicalPayCents: pay.paycheckCents,
    nextPayday: payday.source === 'period_end' ? null : payday.date,
    estimate: payday.estimate,
    employer: employer && merchantDisplayName(employer.newest, { masks: await accountMasks(db) }),
    since: employer?.firstPaycheck ?? null,
  }
}

/** The owner's typical month as of today: the one place income and spending are worked out. */
export async function typicalMonth(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<TypicalMonth> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const currentPay = await readCurrentPay(db, settings, today)
  const since = currentPay.employer?.firstPaycheck ?? null
  const window = spendingWindow(today, since, await firstTransactionDay(db))
  const spending = await monthlySpending(db, settings, window, today)
  return {
    pay: await payScheduleOf(db, currentPay, settings, today),
    monthly: {
      incomeCents: currentPay.monthlyCents,
      incomeEstimated: currentPay.estimate,
      ...spending,
      spendingSince: window?.start ?? null,
      spendingDays: window?.days ?? 0,
    },
    currentPay,
  }
}
