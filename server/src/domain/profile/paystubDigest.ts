// The digest's words for the newest confirmed paystub (digest.ts): yearly
// gross pay and what it rests on, taxes withheld and the effective tax rate,
// and what goes to retirement from pay. Totals and shares only: never the
// employer, an account or member number, or anything else that names someone.

import { dateParts } from '../../lib/dates.js'
import { shortDate } from '../../lib/words.js'
import type { Column, YearlyBasis } from '../paystubs/derived.js'
import type { FinancialProfile } from './profile.js'

type Money = (cents: number) => string

/** How yearly gross pay was worked out, in plain words. */
const BASIS_WORDS: Record<YearlyBasis, string> = {
  frequency: 'its gross pay times the paychecks in a year',
  regularPay: "its regular pay times the paychecks in a year, leaving out this paycheck's bonus",
  yearToDate: 'pay so far this year, scaled to a full year',
  salary: 'the yearly salary it states',
}

/** Which column of the paystub a share was read from. */
const COLUMN_WORDS: Record<Column, string> = {
  current: 'this paycheck',
  yearToDate: 'the year so far',
}

/** A share of gross pay as a whole percent, with the column it was read from. */
const percentOf = (share: { rate: number; basis: Column }) =>
  `about ${Math.round(share.rate * 100)}% of gross (from ${COLUMN_WORDS[share.basis]})`

/** "federal $7,350, state $3,147", leaving out what the paystub does not show; null with neither. */
function withheldWords(taxes: NonNullable<FinancialProfile['paystub']>['taxes'], money: Money) {
  const parts = [
    taxes.federalWithheldCents === null ? null : `federal ${money(taxes.federalWithheldCents)}`,
    taxes.stateWithheldCents === null ? null : `state ${money(taxes.stateWithheldCents)}`,
  ].filter((part): part is string => part !== null)
  return parts.length ? parts.join(', ') : null
}

/** The newest confirmed paystub's figures, or null without a recent one. */
export function paystubLine({ paystub, asOf, locale }: FinancialProfile, money: Money) {
  if (!paystub) return null
  const { yearlyGross, taxes, retirement } = paystub
  const parts = [`Confirmed paystub paid ${shortDate(paystub.paidOn, locale)}:`]
  if (yearlyGross) {
    parts.push(
      `yearly gross pay about ${money(yearlyGross.cents)}, from ${BASIS_WORDS[yearlyGross.basis]}.`,
    )
  }
  const withheld = withheldWords(taxes, money)
  // Last year's totals are named by their year, never read as this year's.
  const sameYear = taxes.year === dateParts(asOf).year
  if (withheld)
    parts.push(
      `Income tax withheld ${sameYear ? 'so far this year' : `in ${taxes.year}`}: ${withheld}.`,
    )
  if (taxes.effectiveRate) {
    parts.push(
      `All taxes withheld come to ${percentOf(taxes.effectiveRate)}; that is withholding, not what is finally owed.`,
    )
  }
  if (retirement)
    parts.push(`Retirement from pay, the employer's part included, is ${percentOf(retirement)}.`)
  // A paystub with none of these figures says nothing worth a line.
  return parts.length > 1 ? parts.join(' ') : null
}
