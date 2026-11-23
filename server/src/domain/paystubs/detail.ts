// A paystub reading turned into the full detail the owner reviews: every
// line, both columns. legacy.ts works out the import figures from it.
// Amounts become cents here; one too large to be real, or printed in a way
// that is not an amount, is dropped and marked to check closely. A line
// whose amount this period is above its year to date is marked too. Pure.

import { MAX_MONTHLY_CENTS } from '../retirement/assumptions.js'
import { centsOf, hoursOf, rateCentsOf } from './amounts.js'
import {
  eachGroup,
  type Groups,
  type LineGroup,
  type LineOf,
  type Pay,
  type PayLine,
  type ReviewLine,
  type ReviewValue,
} from './lines.js'
import type { PaystubReading, ReadFigure, ReadLine } from './reading.js'
import { redactSource } from './redact.js'

/**
 * A paycheck figure above this is surely a misread: $100,000 in one period.
 * It is the most a pension or retirement contribution may be, so a figure
 * the review allows can always be applied to one.
 */
export const MAX_PERIOD_CENTS = MAX_MONTHLY_CENTS
/** And a year-to-date figure, or a yearly salary, above $1,000,000. */
export const MAX_YEAR_CENTS = 100_000_000
/** An hourly rate above $10,000 an hour. */
export const MAX_RATE_CENTS = 1_000_000
/** More hours than a month holds (31 x 24) cannot be one period's. */
export const MAX_HOURS = 744

/** Every line of a paystub as the owner reviews it. */
export type ExtractedDetail = { pay: Pay<ReviewLine, ReviewValue> } & Groups<ReviewLine>

/** A line's place in the detail: a pay line, or a line of one group. */
export type LinePath =
  readonly ['pay', PayLine] | { [G in LineGroup]: readonly [G, LineOf<G>] }[LineGroup]

/** Anything holding lines of shape L where the detail does: the review or the confirmed figures. */
export type HasLines<L> = { pay: Record<PayLine, L> } & Groups<L>

/** The line at a path. */
export function lineAt<L>(detail: HasLines<L>, [group, line]: LinePath): L {
  return (detail[group] as Record<string, L>)[line]!
}

/** A parsed amount kept when it is real and within `max`; null otherwise, with whether to flag it. */
function plausible(
  printed: string | null,
  parse: (text: string) => number | null,
  max: number,
): { value: number | null; unreadable: boolean } {
  if (printed === null) return { value: null, unreadable: false }
  const value = parse(printed)
  const kept = value !== null && value <= max
  return { value: kept ? value : null, unreadable: !kept }
}

/** Whether a period's amount is above the year so far, as no real line is: the columns are swapped. */
function columnsSwapped(current: number | null, yearToDate: number | null): boolean {
  return current !== null && yearToDate !== null && current > yearToDate
}

/**
 * One line for review: both amounts in cents, flagged low when either was
 * printed but unreadable, or when the two columns cannot both be right. Its
 * source is redacted wherever the reader filed it, so a support order filed
 * under any line is never named.
 */
function reviewLine(read: ReadLine): ReviewLine {
  const current = plausible(read.current, centsOf, MAX_PERIOD_CENTS)
  const yearToDate = plausible(read.yearToDate, centsOf, MAX_YEAR_CENTS)
  const doubtful =
    current.unreadable || yearToDate.unreadable || columnsSwapped(current.value, yearToDate.value)
  return {
    current: current.value,
    yearToDate: yearToDate.value,
    confidence: doubtful ? 'low' : read.confidence,
    source: redactSource(read.source),
  }
}

/** One single figure for review, parsed its own way and held to its own limit. */
function reviewValue(
  read: ReadFigure,
  parse: (text: string) => number | null,
  max: number,
): ReviewValue {
  const { value, unreadable } = plausible(read.amount, parse, max)
  return {
    value,
    confidence: unreadable ? 'low' : read.confidence,
    source: redactSource(read.source),
  }
}

/**
 * Every line of the reading, ready for review. Take-home pay above gross pay
 * cannot be right, so both are marked for a second look.
 */
export function detailFrom(reading: PaystubReading): ExtractedDetail {
  const gross = reviewLine(reading.pay.gross)
  const net = reviewLine(reading.pay.net)
  if (gross.current !== null && net.current !== null && net.current > gross.current) {
    gross.confidence = 'low'
    net.confidence = 'low'
  }
  const groups = eachGroup((group, line) =>
    reviewLine((reading[group] as Record<string, ReadLine>)[line]!),
  )
  // After-tax "other" is where a garnishment or support order belongs, so its
  // line is never shown, even in words redaction does not know.
  groups.postTax.other.source = null
  return {
    pay: {
      gross,
      net,
      hours: reviewValue(reading.pay.hours, hoursOf, MAX_HOURS),
      hourlyRate: reviewValue(reading.pay.hourlyRate, rateCentsOf, MAX_RATE_CENTS),
      annualSalary: reviewValue(reading.pay.annualSalary, centsOf, MAX_YEAR_CENTS),
    },
    ...groups,
  }
}
