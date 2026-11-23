// The owner's pay as the Payday screen and an assistant see it: what the
// paychecks show (and whether the owner confirmed it), their own pay if they
// entered one, and the pay every figure goes by. Employers are named the way
// the app names deposits, never with an account number or mask.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { accountMasks } from '../accounts.js'
import type { Settings } from '../settings.js'
import { merchantDisplayName } from '../transactionName.js'
import type { PayCadence } from './cadence.js'
import type { CurrentPay, Employer } from './current.js'
import {
  employerKeyOf,
  isConfirmed,
  ownMonthlyCents,
  withOwnersPay,
  type PayOverride,
} from './ownPay.js'
import { nextOwnPayday } from './ownSchedule.js'
import { paycheckPeriod, type PaycheckPeriod } from './period.js'
import type { Paycheck } from './paychecks.js'
import { readDetectedPay } from './source.js'

export interface FoundEmployer {
  name: string
  paycheckCents: number
  cadence: Cadence
  /** Its paychecks over a year, spread across twelve months. */
  monthlyCents: number
  nextPayday: IsoDate
  lastPaycheck: IsoDate
  paychecks: number
  /** True until a second paycheck (or the owner) confirms how often it pays. */
  estimate: boolean
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
  /** A paycheck budget period on the found schedule, for the budget period picker. */
  period: PaycheckPeriod | null
}

type Namer = (employer: Employer) => string

function foundEmployer(employer: Employer, name: Namer): FoundEmployer {
  return {
    name: name(employer),
    paycheckCents: employer.paycheckCents,
    cadence: employer.cadence,
    monthlyCents: employer.monthlyCents,
    nextPayday: employer.nextPayday,
    lastPaycheck: employer.lastPaycheck,
    paychecks: employer.paychecks,
    estimate: employer.estimate,
  }
}

/** The main employer's paychecks, oldest first. */
function mainPaychecks(pay: CurrentPay): Paycheck[] {
  if (!pay.employer) return []
  const key = employerKeyOf(pay.employer)
  return pay.paychecks.filter((paycheck) => paycheck.payerKey === key)
}

/** The newest paycheck from any employer paying now. */
function newestPaycheck(pay: CurrentPay): Paycheck | undefined {
  const paying = new Set(pay.employers.map(employerKeyOf))
  return pay.paychecks.filter((paycheck) => paying.has(paycheck.payerKey)).at(-1)
}

function foundOf(detected: CurrentPay, settings: Settings, name: Namer): FoundPay | null {
  const main = detected.employer
  if (!main) return null
  const confirmed = isConfirmed(main, settings.pay.confirmed)
  return {
    employers: detected.employers.map((employer) => foundEmployer(employer, name)),
    paycheckCents: main.paycheckCents,
    cadence: main.cadence,
    monthlyCents: detected.monthlyCents!,
    nextPayday: detected.nextPayday!,
    // Confirming the main employer settles it; a second job's own guess still stands.
    estimate: detected.employers.some(
      (employer, i) => employer.estimate && !(i === 0 && confirmed),
    ),
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

/** The view, from pay as the paychecks show it. Pure. */
export function payViewOf(
  detected: CurrentPay,
  settings: Settings,
  today: IsoDate,
  name: Namer,
): PayView {
  const found = foundOf(detected, settings, name)
  const pay = withOwnersPay(detected, settings.pay, today)
  const override = settings.pay.override
  const paychecks = mainPaychecks(detected)
  const last = newestPaycheck(detected)
  return {
    found,
    yours: override && {
      ...override,
      nextPayday: nextOwnPayday(override, today),
      monthlyCents: ownMonthlyCents(override),
    },
    pay: inUseOf(pay, settings, found),
    lastPaycheck: last ? { date: last.date, amountCents: last.amountCents } : null,
    paydays: paychecks.map((paycheck) => paycheck.date),
    period:
      detected.employer && paychecks.length
        ? paycheckPeriod(
            detected.employer.cadence as PayCadence,
            detected.employer.lastPaycheck,
            paychecks.map((p) => p.date),
          )
        : null,
  }
}

/** The owner's pay as the Payday screen shows it, read fresh. */
export async function readPayView(db: Db, settings: Settings, today: IsoDate): Promise<PayView> {
  const detected = await readDetectedPay(db, today)
  const masks = await accountMasks(db)
  return payViewOf(detected, settings, today, (employer) =>
    merchantDisplayName(employer.newest, { masks }),
  )
}
