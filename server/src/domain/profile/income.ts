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
import { listCategories } from '../categories.js'
import { essentialCentsOf, readEssentialMonths } from '../essentialMonths.js'
import { firstTransactionDay } from '../monthlyTotals.js'
import type { CurrentPay, Employer } from '../pay/current.js'
import { namesBusiness } from '../pay/deposits.js'
import { ownMonthlyCents } from '../pay/ownPay.js'
import { readCurrentPay } from '../pay/source.js'
import { paydayFrom, type PaydaySource } from '../pay/payday.js'
import { nextOwnPayday } from '../pay/periodPayday.js'
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

/** One employer paying now. */
export interface PayingEmployer {
  /**
   * Named as the app names its deposits, only when the bank's text says it
   * is a business ("Acme Corp"): a household or a sole trader paying under
   * their own name ("JOHN SMITH DIR DEP") is a private person, never named
   * to the AI. Null otherwise.
   */
  name: string | null
  cadence: Cadence
  /** A usual paycheck from it. */
  typicalPayCents: number
  /** A usual month of pay from it. */
  monthlyCents: number
  since: IsoDate
  nextPayday: IsoDate
  /** True while it has paid once, so its cadence is a guess. */
  estimate: boolean
}

/** Pay the owner entered that stands in for no job the bank shows (pay/ownPay.ts). */
export interface EnteredPay {
  cadence: Cadence
  /** One paycheck, as they entered it. */
  typicalPayCents: number
  monthlyCents: number
  nextPayday: IsoDate
}

export interface PaySchedule {
  /** How often the main employer pays; null when no employer is paying now. */
  cadence: Cadence | null
  /** Where the schedule came from; null when nothing gave one. */
  source: Exclude<PaydaySource, 'period_end'> | null
  /** A usual paycheck from the main employer, the one paying the most a month. */
  typicalPayCents: number | null
  /** The main employer's next payday: what safe to spend runs until. */
  nextPayday: IsoDate | null
  /** True while the main employer's cadence is unconfirmed: the next payday is a projection. */
  estimate: boolean
  /**
   * The main employer's name, as PayingEmployer names it, or null; null too
   * when the main pay is the owner's own, standing in for no job (`entered`).
   */
  employer: string | null
  /** Every employer paying now, the main one first: a second job counts beside the first. */
  employers: PayingEmployer[]
  /**
   * The pay the owner entered, when it stands in for no job found (none was
   * found as it was entered, or the job it was entered for stopped): it is
   * the main pay, and every employer listed counts beside it. Null when they
   * entered none, or it stands in for a job, which is then listed as that job.
   */
  entered: EnteredPay | null
  /** The first paycheck from any employer paying now: where typical income starts. */
  since: IsoDate | null
}

export interface MonthlyAverages {
  /** A month of pay from the current employer, take-home; null when no employer is paying now. */
  incomeCents: number | null
  /**
   * True while any employer's cadence is unconfirmed (one paycheck, or
   * paydays that fit two cadences): the month is the cautious projection.
   */
  incomeEstimated: boolean
  /** Spending a month, transfers and card payments left out; null with too little history. */
  spendingCents: number | null
  /**
   * Spending in the essential categories: the owner's pick, or the ones found
   * by their codes and names with loan and child care payments filed
   * elsewhere (essentialSpending.ts), or all spending when none are.
   */
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

/** Spending a month over the window, and its essential share. */
async function monthlySpending(
  db: Db,
  settings: Settings,
  window: { start: IsoDate; days: number } | null,
  today: IsoDate,
) {
  if (window === null) return { spendingCents: null, essentialSpendingCents: null }
  const range = { start: window.start, end: today }
  // The same reading the emergency fund's essentials go by (essentialMonths.ts).
  const [month] = await readEssentialMonths(db, [range])
  const categories = await listCategories(db)
  const essential = essentialCentsOf(categories, month!, settings.savingsPlan.essentialCategoryIds)
  const perMonth = (cents: number) => Math.round((cents * DAYS_PER_MONTH) / window.days)
  return {
    spendingCents: perMonth(month!.spentCents),
    essentialSpendingCents: perMonth(essential),
  }
}

/** The first paycheck from any employer paying now, or null with none. */
export function payingSince(pay: CurrentPay): IsoDate | null {
  const firsts = pay.employers.map((employer) => employer.firstPaycheck).sort()
  return firsts[0] ?? null
}

/** An employer's name, only when it names a business (see PayingEmployer), never an account mask. */
function employerName(employer: Employer, masks: string[]): string | null {
  return namesBusiness(employer.newest) ? merchantDisplayName(employer.newest, { masks }) : null
}

/** The owner's own pay when it stands in for no job: the main pay, with no employer for it. */
function enteredPay(pay: CurrentPay, settings: Settings, today: IsoDate): EnteredPay | null {
  const { override } = settings.pay
  if (!override || pay.employer) return null
  return {
    cadence: override.cadence,
    typicalPayCents: override.amountCents,
    monthlyCents: ownMonthlyCents(override),
    nextPayday: nextOwnPayday(override, today),
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
  const source = payday.source === 'period_end' ? null : payday.source
  // Named only as the app names deposits: never an account number or mask.
  const masks = await accountMasks(db)
  const employers = pay.employers.map((employer) => ({
    name: employerName(employer, masks),
    cadence: employer.cadence,
    typicalPayCents: employer.paycheckCents,
    monthlyCents: employer.monthlyCents,
    since: employer.firstPaycheck,
    nextPayday: employer.nextPayday,
    estimate: employer.estimate,
  }))
  return {
    cadence: source ? payday.cadence : null,
    source,
    typicalPayCents: pay.paycheckCents,
    nextPayday: source ? payday.date : null,
    estimate: payday.estimate,
    // The main pay's payer: never a job the owner's own pay only counts beside.
    employer: pay.employer ? employerName(pay.employer, masks) : null,
    employers,
    entered: enteredPay(pay, settings, today),
    since: payingSince(pay),
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
  const since = payingSince(currentPay)
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
