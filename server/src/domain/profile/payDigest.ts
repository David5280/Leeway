// The digest's words for pay (digest.ts): how often it comes, from whom,
// and when next. An employer is named only as the profile names it (a
// business, never a person), and pay the owner entered for no job found is
// said to be theirs, never credited to a job it only counts beside.

import type { Cadence } from '../../lib/periods.js'
import { shortDate } from '../../lib/words.js'
import type { FinancialProfile } from './profile.js'

type Money = (cents: number) => string
type PaySchedule = FinancialProfile['pay']

const CADENCE_WORDS: Record<Cadence, string> = {
  week: 'every week',
  biweek: 'every 2 weeks',
  semimonth: 'twice a month',
  month: 'monthly',
  quarter: 'every 3 months',
  year: 'once a year',
}

/**
 * "Initech Inc twice a month since Nov 13, about $2,000 each", for one of
 * several employers; one not named as a business is "the main employer" or
 * "another employer", never a person's name read from the bank.
 */
function employerWords(
  employer: PaySchedule['employers'][number],
  index: number,
  locale: string,
  money: Money,
): string {
  const since = shortDate(employer.since, locale)
  const name = employer.name ?? (index === 0 ? 'the main employer' : 'another employer')
  return `${name} ${CADENCE_WORDS[employer.cadence]} since ${since}, about ${money(employer.typicalPayCents)} each${paystubWords(employer)}`
}

/** Said of a paycheck whose size a confirmed paystub gives, not the bank's deposits. */
const paystubWords = (employer: { fromPaystub?: boolean }) =>
  employer.fromPaystub ? ' (take-home from a confirmed paystub)' : ''

/** Said when a job's cadence is still a guess. */
const guessWords = (pay: PaySchedule) =>
  pay.employers.some((employer) => employer.estimate)
    ? ' This is an estimate until more paychecks confirm how often each employer pays.'
    : ''

/** The pay the owner entered for no job found, then every job it counts beside. */
function enteredLine(pay: PaySchedule, locale: string, money: Money): string {
  const entered = pay.entered!
  const own = `Pay: the owner's own pay, as they entered it, ${CADENCE_WORDS[entered.cadence]}, about ${money(entered.typicalPayCents)} each, next on ${shortDate(pay.nextPayday!, locale)}.`
  if (pay.employers.length === 0) return own
  // None of these is the main employer: the owner's own pay is.
  const each = pay.employers.map((employer, i) => employerWords(employer, i + 1, locale, money))
  return `${own} It counts beside ${each.join('; ')}.${guessWords(pay)}`
}

/** How often pay comes, from whom, and when next; null when no pay is known. */
export function payLine({ pay, locale }: FinancialProfile, money: Money): string | null {
  if (!pay.cadence || !pay.nextPayday) return null
  if (pay.entered) return enteredLine(pay, locale, money)
  if (pay.employers.length > 1) {
    // A second job counts beside the first, so each is named with its own schedule, and its guess said.
    const each = pay.employers.map((employer, i) => employerWords(employer, i, locale, money))
    return `Pay: from ${pay.employers.length} employers: ${each.join('; ')}. Next payday ${shortDate(pay.nextPayday, locale)}.${guessWords(pay)}`
  }
  const main = pay.employers[0]
  const amount =
    pay.typicalPayCents === null
      ? ''
      : `, about ${money(pay.typicalPayCents)} each${main ? paystubWords(main) : ''}`
  const from = pay.employer ? ` from ${pay.employer}` : ''
  const since = pay.since ? ` since ${shortDate(pay.since, locale)}` : ''
  // Too few paychecks cannot show how often pay comes, so the schedule is said to be a guess.
  const estimate = pay.estimate
    ? ' This is an estimate until more paychecks confirm how often pay comes.'
    : ''
  return `Pay: ${CADENCE_WORDS[pay.cadence]}${from}${since}${amount}, next on ${shortDate(pay.nextPayday, locale)}.${estimate}`
}

/** Where a month's pay comes from: "from the current employer", or "as the owner entered it". */
export function payFromWords({ employers, entered }: PaySchedule): string {
  const jobs =
    employers.length > 1
      ? `from the ${employers.length} current employers`
      : 'from the current employer'
  if (!entered) return jobs
  return employers.length ? `as the owner entered it and ${jobs}` : 'as the owner entered it'
}
