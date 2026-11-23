// A cadence the owner gave, and the job it speaks for. Pure.
//
// Each speaks only for the job it came from. The owner's confirmation names
// its payer (ownPay.ts). A saved paystub names none the bank's way: one
// from a job that has since ended must never set how often a new one pays,
// so it counts for the main employer only when it was paid during that
// job's run of paychecks, or names the same payer the bank does.

import { addDays, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { textKey } from '../merchantKey.js'
import { SMALL_WORDS } from '../merchantName.js'
import type { EmployerRun } from './paychecks.js'

/** A cadence from a saved paystub, with what it shows of the job it came from. */
interface PaystubCadence {
  cadence: Cadence
  paystub: {
    /** The day it was paid, or null when it shows none. */
    payDate: IsoDate | null
    employerName: string | null
  }
}

/** A cadence the owner confirmed for one payer, by its key (paychecks.ts). */
interface ConfirmedCadence {
  cadence: Cadence
  payerKey: string
}

/**
 * A cadence alone, speaking for the main job whatever it is. Nothing in the
 * app gives one this way now, since a paystub and a confirmation each name
 * their job; it stays so a cadence can be read on its own, as tests do.
 */
interface MainJobCadence {
  cadence: Cadence
}

export type GivenCadence = PaystubCadence | ConfirmedCadence | MainJobCadence

/**
 * Days a paystub may predate the first paycheck seen from a job and still be
 * from it: the first deposit can post a day or two after the paystub's date.
 */
export const PAYSTUB_RUN_SLACK_DAYS = 5

/** Words in a company's name that say nothing of which company: "Inc", "Corp", "Payroll". */
const COMPANY_WORDS = new Set([
  'inc',
  'corp',
  'corporation',
  'llc',
  'ltd',
  'co',
  'company',
  'payroll',
])

/** Whether a paystub's employer name and a payer's key, read from the bank's text, share a name word. */
export function namesPayer(employerName: string, payerKey: string): boolean {
  // Both read alike: a key keeps a number naming its payer ("7eleven"), a stub's name drops it.
  const payerWords = new Set(textKey(payerKey).split(' '))
  return textKey(employerName)
    .split(' ')
    .some(
      (word) =>
        word.length > 1 &&
        !SMALL_WORDS.has(word) &&
        !COMPANY_WORDS.has(word) &&
        payerWords.has(word),
    )
}

/**
 * Whether a given cadence speaks for a run: a confirmation for its own
 * payer, a paystub for its own job, and a cadence alone for any.
 */
export function givenFor(given: GivenCadence, run: EmployerRun): boolean {
  if ('payerKey' in given) return given.payerKey === run.payerKey
  if (!('paystub' in given)) return true
  const { paystub } = given
  const runStart = addDays(run.paychecks[0]!.date, -PAYSTUB_RUN_SLACK_DAYS)
  if (paystub.payDate !== null && paystub.payDate >= runStart) return true
  return paystub.employerName !== null && namesPayer(paystub.employerName, run.payerKey)
}
