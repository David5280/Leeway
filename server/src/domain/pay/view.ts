// The owner's pay as the Payday screen and an assistant see it: what the
// paychecks show (and whether the owner confirmed it), their own pay if they
// entered one, and the pay every figure goes by. Employers are named the way
// the app names deposits, never with an account number or mask, and only
// when the payer is a business: a payroll paid in a person's name is not
// named at all.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { accountMasks } from '../accounts.js'
import type { Settings } from '../settings.js'
import { merchantDisplayName } from '../transactionName.js'
import type { PayCadence } from './cadence.js'
import type { CurrentPay, Employer } from './current.js'
import { namesBusiness } from './deposits.js'
import {
  employerIdOf,
  isConfirmed,
  ownMonthlyCents,
  replacedIndex,
  withOwnersPay,
  type PayOverride,
  type SavedOverride,
} from './ownPay.js'
import { nextOwnPayday } from './ownSchedule.js'
import { paycheckPeriod, type PaycheckPeriod } from './period.js'
import { payerKeyOf, type Paycheck } from './paychecks.js'
import { readFoundPay } from './source.js'

export interface FoundEmployer {
  /** Tells employers apart without naming them. */
  id: string
  /** Null when the payer is not a business, so no person is named. */
  name: string | null
  paycheckCents: number
  cadence: Cadence
  /** Its paychecks over a year, spread across twelve months. */
  monthlyCents: number
  nextPayday: IsoDate
  lastPaycheck: IsoDate
  paychecks: number
  /** True until a second paycheck (or the owner) confirms how often it pays. */
  estimate: boolean
  /** True when the owner's own pay stands in for this job's. */
  replaced: boolean
}

/** What the paychecks show, the main employer first. */
export interface FoundPay {
  employers: FoundEmployer[]
  paycheckCents: number
  cadence: Cadence
  monthlyCents: number
  nextPayday: IsoDate
  estimate: boolean
  /** Whether the owner said the main employer's pay is right. */
  confirmed: boolean
  /**
   * True when the owner said an earlier reading was right, but the paychecks
   * now show another employer or cadence: their word no longer holds.
   */
  confirmationStale: boolean
}

/** Where the pay every figure goes by came from. */
export type PaySource = 'found' | 'confirmed' | 'yours'

/** The pay every figure goes by. */
export interface PayInUse {
  source: PaySource
  paycheckCents: number
  cadence: Cadence
  monthlyCents: number
  nextPayday: IsoDate
  /** The paycheck expected that day: with two jobs, the one that lands then. */
  nextPaycheckCents: number
  estimate: boolean
}

/** The owner's own pay, its next payday stepped on to today or after. */
export interface YourPay extends PayOverride {
  /** What it comes to in a month. */
  monthlyCents: number
}

export interface PayView {
  /** Null when no employer is paying now. */
  found: FoundPay | null
  /** The owner's own pay; null when they gave none. */
  yours: YourPay | null
  /** Null with neither paychecks found nor the owner's own pay. */
  pay: PayInUse | null
  /** The newest paycheck from an employer paying now. */
  lastPaycheck: { date: IsoDate; amountCents: number } | null
  /** The main employer's paydays seen, oldest first. */
  paydays: IsoDate[]
  /**
   * A paycheck budget period on the schedule of the pay in use (the owner's
   * own when they entered it, else the paychecks'), for the period picker.
   */
  period: PaycheckPeriod | null
}

type Namer = (employer: Employer) => string | null

function foundEmployer(employer: Employer, name: Namer, replaced: boolean): FoundEmployer {
  return {
    id: employerIdOf(employer),
    name: name(employer),
    paycheckCents: employer.paycheckCents,
    cadence: employer.cadence,
    monthlyCents: employer.monthlyCents,
    nextPayday: employer.nextPayday,
    lastPaycheck: employer.lastPaycheck,
    paychecks: employer.paychecks,
    estimate: employer.estimate,
    replaced,
  }
}

/** The key an employer's paychecks are grouped by (paychecks.ts). */
const keyOf = (employer: Employer) => payerKeyOf(employer.newest)

/** The main employer's paychecks, oldest first. */
function mainPaychecks(pay: CurrentPay): Paycheck[] {
  if (!pay.employer) return []
  const key = keyOf(pay.employer)
  return pay.paychecks.filter((paycheck) => paycheck.payerKey === key)
}

/** The newest paycheck from any employer paying now. */
function newestPaycheck(pay: CurrentPay): Paycheck | undefined {
  const paying = new Set(pay.employers.map(keyOf))
  return pay.paychecks.filter((paycheck) => paying.has(paycheck.payerKey)).at(-1)
}

function foundOf(reading: CurrentPay, settings: Settings, name: Namer): FoundPay | null {
  const main = reading.employer
  if (!main) return null
  const confirmed = isConfirmed(main, settings.pay.confirmed)
  const { override } = settings.pay
  const replaced = override ? replacedIndex(reading.employers, override) : -1
  return {
    employers: reading.employers.map((employer, i) =>
      foundEmployer(employer, name, i === replaced),
    ),
    paycheckCents: main.paycheckCents,
    cadence: main.cadence,
    monthlyCents: reading.monthlyCents!,
    nextPayday: reading.nextPayday!,
    // Confirming the main employer settles it; a second job's own guess still stands.
    estimate: reading.employers.some((employer, i) => employer.estimate && !(i === 0 && confirmed)),
    confirmed,
    // A confirmation of a reading the paychecks no longer show is said, not kept quiet.
    confirmationStale: settings.pay.confirmed !== null && !confirmed,
  }
}

function inUseOf(pay: CurrentPay, settings: Settings, found: FoundPay | null): PayInUse | null {
  if (pay.paycheckCents === null || pay.nextPayday === null) return null
  let source: PaySource = 'found'
  if (settings.pay.override) source = 'yours'
  else if (found?.confirmed) source = 'confirmed'
  return {
    source,
    paycheckCents: pay.paycheckCents,
    cadence: pay.cadence!,
    monthlyCents: pay.monthlyCents!,
    nextPayday: pay.nextPayday,
    nextPaycheckCents: pay.nextPaycheckCents ?? pay.paycheckCents,
    estimate: pay.estimate,
  }
}

/**
 * The paycheck budget period for the pay in use: on the owner's own
 * schedule when they entered their pay, else on the one the main
 * employer's paychecks keep; null with neither.
 */
export function periodOfPay(
  found: CurrentPay,
  override: PayOverride | null,
): PaycheckPeriod | null {
  if (override) return paycheckPeriod(override.cadence, override.nextPayday)
  const paydays = mainPaychecks(found).map((paycheck) => paycheck.date)
  if (!found.employer || paydays.length === 0) return null
  const { cadence, lastPaycheck } = found.employer
  return paycheckPeriod(cadence as PayCadence, lastPaycheck, paydays)
}

/** The owner's own pay as shown: its next payday stepped on to today or after. */
function yoursOf(override: SavedOverride, today: IsoDate): YourPay {
  const { amountCents, cadence } = override
  return {
    amountCents,
    cadence,
    nextPayday: nextOwnPayday(override, today),
    monthlyCents: ownMonthlyCents(override),
  }
}

/** The view, from pay as the paychecks show it (confirmed, where it is). Pure. */
export function payViewOf(
  found: CurrentPay,
  settings: Settings,
  today: IsoDate,
  name: Namer,
): PayView {
  const { override } = settings.pay
  const shown = foundOf(found, settings, name)
  const last = newestPaycheck(found)
  return {
    found: shown,
    yours: override && yoursOf(override, today),
    pay: inUseOf(withOwnersPay(found, settings.pay, today), settings, shown),
    lastPaycheck: last ? { date: last.date, amountCents: last.amountCents } : null,
    paydays: mainPaychecks(found).map((paycheck) => paycheck.date),
    period: periodOfPay(found, override),
  }
}

/** Names an employer as the app names its deposits, only when the payer is a business. */
function employerNamer(masks: string[]): Namer {
  return (employer) =>
    namesBusiness(employer.newest) ? merchantDisplayName(employer.newest, { masks }) : null
}

/** The owner's pay as the Payday screen shows it, read fresh. */
export async function readPayView(db: Db, settings: Settings, today: IsoDate): Promise<PayView> {
  const found = await readFoundPay(db, settings, today)
  return payViewOf(found, settings, today, employerNamer(await accountMasks(db)))
}
