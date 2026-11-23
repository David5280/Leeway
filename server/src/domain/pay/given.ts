// A cadence the owner gave, and the job it speaks for. Pure.
//
// A paycheck budget period is the owner's word on how often the main job
// pays. A saved paystub speaks only for the job it came from: one from a
// job that has since ended must never set how often a new one pays, so it
// counts for the main employer only when it names the same payer the bank
// does, or names no payer seen and was paid during that job's run of paychecks.

import { addDays, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { textKey } from '../merchantKey.js'
import { SMALL_WORDS } from '../merchantName.js'
import { withoutPayWords } from './deposits.js'
import type { EmployerRun } from './paychecks.js'

export interface GivenCadence {
  cadence: Cadence
  /** The paystub it came from; absent when a paycheck budget period gave it. */
  paystub?: {
    /** The day it was paid, or null when it shows none. */
    payDate: IsoDate | null
    employerName: string | null
  }
}

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

/** How many leading name words two names are held to, at most. */
const LEADING_WORDS = 2

/**
 * The words of a name that say which company it is, in order: no small word
 * ("of"), company word ("Inc", "Payroll"), pay word ("DIR DEP") or single
 * letter. Read as textKey reads text, so a stub's name and a key read alike.
 */
function nameWords(text: string): string[] {
  return textKey(withoutPayWords(text))
    .split(' ')
    .filter((word) => word.length > 1 && !SMALL_WORDS.has(word) && !COMPANY_WORDS.has(word))
}

/**
 * Whether a paystub's employer name and a payer's key, read from the bank's
 * text, name the same payer. One shared word is not enough, since many
 * employers share one ("State of Colorado" and "Univ of Colorado"). Either
 * - both start with the same name words, as far as the shorter goes and at
 *   most two: "Initech, Inc." and "INITECH PAYROLL", or
 * - most of the stub's name words are in the key, for a bank line that puts
 *   its own labels first: "Acme Corp" and "ORIG CO NAME:ACME CORP ...".
 */
export function namesPayer(employerName: string, payerKey: string): boolean {
  const stub = nameWords(employerName)
  const payer = nameWords(payerKey)
  if (stub.length === 0 || payer.length === 0) return false
  const leading = Math.min(stub.length, payer.length, LEADING_WORDS)
  const sameStart = stub.slice(0, leading).every((word, index) => payer[index] === word)
  const shared = stub.filter((word) => payer.includes(word)).length
  return sameStart || shared > stub.length / 2
}

/**
 * Whether a given cadence speaks for a run: a budget period's always, a
 * paystub's only for its own job. A stub that names this run's payer is its
 * own; one that names another payer seen (`others`, an old job's) is that
 * job's, whatever its date; one that names neither, as when the bank shows
 * only a payroll service, counts when it was paid during the run.
 */
export function givenFor(given: GivenCadence, run: EmployerRun, others: EmployerRun[]): boolean {
  const { paystub } = given
  if (!paystub) return true
  const { employerName, payDate } = paystub
  if (employerName !== null) {
    if (namesPayer(employerName, run.payerKey)) return true
    if (others.some((other) => namesPayer(employerName, other.payerKey))) return false
  }
  const runStart = addDays(run.paychecks[0]!.date, -PAYSTUB_RUN_SLACK_DAYS)
  return payDate !== null && payDate >= runStart
}
