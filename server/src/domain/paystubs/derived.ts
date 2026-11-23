// The figures a paystub implies, worked out from its confirmed lines: yearly
// pay, how much goes to tax, how much is saved for retirement, and how much
// reaches the owner. Each one says what it was worked out from, so the
// owner can see whether it rests on one paycheck or the year so far.
//
// Rates are fractions (0.25 is 25%), rounded only when shown. A figure that
// needs a line the paystub does not show is null, never a guess or 0. The
// one exception is the paystub's own convention (shareOf): a line blank this
// period beside a printed year so far took nothing this period.
// Pure, and shared with the web app, which shows these on the review screen.

import { dateParts, makeDate, toDayNumber } from '../../lib/dates.js'
import { PER_YEAR } from '../../lib/periods.js'
import type { PAY_CADENCES } from '../retirement/pensions.js'
import { sumKnown, type CentsLine, type Groups, type Pay } from './lines.js'

/** What a paystub's figures are read from: the confirmed lines and how often pay comes. */
export type DerivableDetail = { pay: Pay<CentsLine, number | null> } & Groups<CentsLine> & {
    payCadence: (typeof PAY_CADENCES)[number] | null
  }

/** A column of the paystub: this period, or the year so far. */
export type Column = keyof CentsLine

/** How yearly pay was worked out. */
export type YearlyBasis = 'frequency' | 'regularPay' | 'yearToDate' | 'salary'

export interface YearlyGross {
  cents: number
  basis: YearlyBasis
}

/** A share of gross pay, and which column of the paystub it was read from. */
export interface Share {
  rate: number
  basis: Column
}

/** A retirement savings rate, with the two parts it adds up. */
export interface SavingsRate extends Share {
  /** Null when the paystub shows none of the employee's contributions in that column. */
  employeeCents: number | null
  /** Null when the paystub shows no employer contribution in that column. */
  employerCents: number | null
}

/** The day of the year a date falls on, 1 to 366, and how many days its year has. */
function dayOfYear(date: string): { day: number; daysInYear: number } {
  const { year } = dateParts(date)
  const newYear = toDayNumber(makeDate(year, 1, 1))
  return {
    day: toDayNumber(date) - newYear + 1,
    daysInYear: toDayNumber(makeDate(year + 1, 1, 1)) - newYear,
  }
}

/**
 * Below this day of the year (31 March, or 30 March in a leap year),
 * year-to-date pay is too little of the year to scale up: a January bonus
 * would read as a raise for the whole year.
 */
export const MIN_DAY_FOR_YEAR_TO_DATE = 90

/**
 * Earnings that do not come every paycheck, so are never multiplied by a
 * year of paychecks. "Other" earnings are left in: the reader files shift
 * differential and holiday pay there, which come back paycheck after paycheck.
 */
const ONE_OFF_EARNINGS = ['bonus', 'commission'] as const

/** This paycheck's one-off earnings, in cents: 0 when it shows none. */
function oneOffCents(detail: DerivableDetail): number {
  return sumKnown(ONE_OFF_EARNINGS.map((line) => detail.earnings[line].current)) ?? 0
}

/**
 * Yearly gross pay, in the most dependable way the paystub allows:
 *
 * 1. frequency: this period's gross times the paychecks in a year (24 twice
 *    a month; about 26.09 every two weeks, counting the extra paycheck some
 *    years bring, as Leeway does everywhere). Steady pay makes this
 *    dependable, so it comes first.
 * 2. When this paycheck has a bonus or commission, multiplying it would
 *    count them every paycheck. Then the yearly salary the paystub states
 *    comes first (salary), and without one, this period's gross less those
 *    earnings times the paychecks in a year (regularPay).
 * 3. yearToDate: year-to-date gross scaled to a full year by how far the pay
 *    date is into it: ytd x (days in year / day of year). Used only when how
 *    often pay comes is unknown, and only from day 90 on, since a one-off
 *    early in the year would be multiplied many times over.
 * 4. salary: the yearly salary the paystub states. Last, as it leaves out
 *    overtime, bonuses and commission.
 */
export function yearlyGross(detail: DerivableDetail, payDate: string | null): YearlyGross | null {
  const { gross, annualSalary } = detail.pay
  const oneOff = oneOffCents(detail)
  // The salary basis serves twice: here for a bonus check, and below as the last fallback.
  if (oneOff > 0 && annualSalary !== null) return { cents: annualSalary, basis: 'salary' }
  // A paycheck with no regular pay, such as one that is all bonus, has nothing to multiply.
  const regular = gross.current === null ? null : gross.current - oneOff
  if (regular !== null && regular > 0 && detail.payCadence !== null) {
    const cents = Math.round(regular * PER_YEAR[detail.payCadence])
    return { cents, basis: oneOff > 0 ? 'regularPay' : 'frequency' }
  }
  if (gross.yearToDate !== null && payDate !== null) {
    const { day, daysInYear } = dayOfYear(payDate)
    if (day >= MIN_DAY_FOR_YEAR_TO_DATE) {
      return { cents: Math.round((gross.yearToDate * daysInYear) / day), basis: 'yearToDate' }
    }
  }
  return annualSalary === null ? null : { cents: annualSalary, basis: 'salary' }
}

/** Adds one column of the lines given. */
const columnSum = (lines: readonly CentsLine[], column: Column) =>
  sumKnown(lines.map((line) => line[column]))

/** Whether a line shows an amount in the column given. */
const shows = (line: CentsLine, column: Column) => line[column] !== null

/** Whether a line prints an amount other than zero in either column: only those move a share. */
const printsMoney = (line: CentsLine) =>
  (line.current !== null && line.current !== 0) ||
  (line.yearToDate !== null && line.yearToDate !== 0)

/** A column's gross pay when it is above zero, the only kind a share can divide by. */
function grossIn(detail: DerivableDetail, column: Column): number | null {
  const gross = detail.pay.gross[column]
  return gross !== null && gross > 0 ? gross : null
}

/**
 * A part of gross pay as a share of it, read from one column.
 * - First, the preferred column that shows every line of the part printing
 *   money in either column: a line printed only in the other column would
 *   otherwise drop out and understate the share, and taking that one line
 *   from the other column would mix this period's figures with the year's.
 *   A line printed only as 0.00 moves no sum, so it never rules a column out.
 * - Else this period, reading a blank beside a printed year so far as
 *   nothing taken this period, as paystubs print it (a Social Security
 *   wage base already reached, a Roth stopped earlier in the year). Only
 *   when some line of the part prints money in both columns, which shows
 *   the paystub prints this period's column for the part at all. The year
 *   column gets no such reading: money taken this period is always in the
 *   year so far, so a line missing there is truly unknown.
 * Null when neither reading works, or the part prints nothing at all.
 */
function shareOf(
  detail: DerivableDetail,
  lines: readonly CentsLine[],
  order: readonly Column[],
): Share | null {
  const withMoney = lines.filter(printsMoney)
  for (const column of order) {
    const gross = grossIn(detail, column)
    // Null when the part prints nothing in this column, so an empty part never reads as 0%.
    const cents = columnSum(lines, column)
    if (gross !== null && cents !== null && withMoney.every((line) => shows(line, column))) {
      return { rate: cents / gross, basis: column }
    }
  }
  const periodPrinted = withMoney.some(
    (line) => shows(line, 'current') && shows(line, 'yearToDate'),
  )
  const gross = grossIn(detail, 'current')
  const cents = columnSum(lines, 'current')
  if (!periodPrinted || gross === null || cents === null) return null
  return { rate: cents / gross, basis: 'current' }
}

/** The year's figures first: withholding swings check to check (a bonus is taxed at its own rate). */
const YEAR_FIRST: readonly Column[] = ['yearToDate', 'current']
/** This period first: it shows today's elections and pay, which is what carries forward. */
const PERIOD_FIRST: readonly Column[] = ['current', 'yearToDate']

/**
 * Effective tax rate: every tax withheld (federal, state, local, Social
 * Security, Medicare, other) divided by gross pay. This is what was
 * withheld, not what is finally owed; a refund or a bill at filing time
 * settles the difference.
 */
export function effectiveTaxRate(detail: DerivableDetail): Share | null {
  return shareOf(detail, Object.values(detail.taxes), YEAR_FIRST)
}

/** The employee's own retirement contributions: traditional, Roth and after-tax plan money, and the pension. */
function employeeRetirement(detail: DerivableDetail): CentsLine[] {
  const { preTax, postTax } = detail
  return [
    preTax.plan401k,
    preTax.plan403b,
    preTax.plan457,
    preTax.pension,
    postTax.roth401k,
    postTax.roth403b,
    postTax.roth457,
    postTax.afterTax,
  ]
}

/**
 * Retirement savings rate: what the employee and the employer put toward
 * retirement, divided by gross pay. The employee's part is every plan
 * contribution, pre-tax, Roth and after-tax, and the pension; the employer's
 * is the match and its pension share. An HSA can be saved for later years
 * but is health money first, so it is left out.
 */
export function retirementSavingsRate(detail: DerivableDetail): SavingsRate | null {
  const employee = employeeRetirement(detail)
  const employer = [detail.employer.match, detail.employer.pension]
  const share = shareOf(detail, [...employee, ...employer], PERIOD_FIRST)
  if (!share) return null
  return {
    rate: share.rate,
    basis: share.basis,
    employeeCents: columnSum(employee, share.basis),
    employerCents: columnSum(employer, share.basis),
  }
}

/** Take-home share: net pay divided by gross pay, the part of each paycheck that reaches the owner. */
export function takeHomeShare(detail: DerivableDetail): Share | null {
  return shareOf(detail, [detail.pay.net], PERIOD_FIRST)
}
