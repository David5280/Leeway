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
import { SMALL_WORDS } from '../merchantCase.js'
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

/**
 * Short forms a bank prints for words a paystub spells out, each read as its
 * full word so "UNIV OF COLORADO PAYROLL" names "University of Colorado".
 * Only short forms with one plain meaning; "Corp" and "Co" are company words
 * above, so they need none.
 */
const SHORT_FORMS = new Map([
  ['univ', 'university'],
  ['intl', 'international'],
  ['natl', 'national'],
  ['svc', 'service'],
  ['svcs', 'services'],
  ['dept', 'department'],
  ['assn', 'association'],
  ['hosp', 'hospital'],
  ['mgmt', 'management'],
  ['ctr', 'center'],
])

/** The full words SHORT_FORMS spell out, too general to name a company alone: "university". */
const GENERAL_WORDS = new Set(SHORT_FORMS.values())

/**
 * The words of a name that say which company it is, in order: no small word
 * ("of"), company word ("Inc", "Payroll"), pay word ("DIR DEP") or single
 * letter, and each short form spelled out ("Univ" is "university"). Read as
 * textKey reads text, so a stub's name and a key read alike.
 */
function nameWords(text: string): string[] {
  return textKey(withoutPayWords(text))
    .split(' ')
    .map((word) => SHORT_FORMS.get(word) ?? word)
    .filter((word) => word.length > 1 && !SMALL_WORDS.has(word) && !COMPANY_WORDS.has(word))
}

/** Whether `run` sits in `words` word for word, side by side: [b, c] in [a, b, c]. */
const holdsRun = (words: string[], run: string[]) =>
  words.some((_, start) => run.every((word, index) => words[start + index] === word))

/**
 * Whether a paystub's employer name and a payer's key, read from the bank's
 * text, name the same payer. Shared words are not enough, since employers
 * share them ("University of Denver" and "UNIV OF COLORADO DENVER"). Either
 * - every name word of the stub is in the key, side by side as the stub
 *   writes them: "University of Colorado" and "UNIV OF COLORADO PAYROLL", or
 *   "Acme Corp" and "ORIG CO NAME:ACME CORP ...", whose labels come first, or
 * - the key names one word, the stub's first, as a bank may print only a
 *   brand: "Acme Widgets Inc" and "ACME PAYROLL". Never a general word, so
 *   "NATL PAYROLL" names no "National Western Life".
 */
export function namesPayer(employerName: string, payerKey: string): boolean {
  const stub = nameWords(employerName)
  const payer = nameWords(payerKey)
  if (stub.length === 0 || payer.length === 0) return false
  if (holdsRun(payer, stub)) return true
  const [brand] = payer
  return payer.length === 1 && brand === stub[0] && !GENERAL_WORDS.has(brand!)
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
