// What a document reader is asked to return for a paystub, and how that is
// checked and cleaned into the figures the owner reviews. Amounts come back
// exactly as printed and are turned into cents here, so the model never does
// arithmetic; every line of text is redacted before anything keeps it. Pure.

import { z } from 'zod'
import { isIsoDate, type IsoDate } from '../../lib/dates.js'
import { MAX_MONTHLY_CENTS } from '../retirement/assumptions.js'
import { PAY_CADENCES } from '../retirement/pensions.js'
import { redactPlanName } from './planName.js'
import { redactEmployer, redactSource } from './redact.js'

/** How sure the reader is of a figure: the owner checks a low one first. */
export const CONFIDENCES = ['high', 'medium', 'low'] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** This period's figures: pay, and each kind of saving taken from it. */
export const CURRENT_FIELDS = [
  'grossPay',
  'netPay',
  'pension',
  'pensionEmployer',
  'plan401k',
  'plan457',
  'plan403b',
  'hsa',
] as const
export type CurrentField = (typeof CURRENT_FIELDS)[number]

/** The year-to-date figures: the same, less the employer's pension share, which few stubs total. */
export const YEAR_TO_DATE_FIELDS = [
  'grossPay',
  'netPay',
  'pension',
  'plan401k',
  'plan457',
  'plan403b',
  'hsa',
] as const
export type YearToDateField = (typeof YEAR_TO_DATE_FIELDS)[number]

export type PayCadence = (typeof PAY_CADENCES)[number]

/** One figure as the reader returns it: the amount as printed and the line it came from. */
const readFigure = z.object({
  amount: z.string().nullable(),
  confidence: z.enum(CONFIDENCES),
  source: z.string().nullable(),
})

/** An object with one figure for each field named. */
function figures<F extends string>(fields: readonly F[]) {
  return z.object(
    Object.fromEntries(fields.map((field) => [field, readFigure])) as Record<F, typeof readFigure>,
  )
}

/**
 * The shape the reader must return, sent to the model as a strict output
 * schema. Kept to strings, enums and nulls: numbers and dates are checked here.
 */
export const paystubReadingSchema = z.object({
  isPaystub: z.boolean(),
  employerName: z.string().nullable(),
  payDate: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  payFrequency: z.object({
    value: z.enum(PAY_CADENCES).nullable(),
    confidence: z.enum(CONFIDENCES),
    source: z.string().nullable(),
  }),
  current: figures(CURRENT_FIELDS),
  yearToDate: figures(YEAR_TO_DATE_FIELDS),
  /** The pension line's plan name as printed, like "PERA", to name a new pension by. */
  pensionPlanName: z.string().nullable(),
})

export type PaystubReading = z.infer<typeof paystubReadingSchema>

/** One figure ready for review: cents, or null when the paystub does not show it. */
export interface ReviewFigure {
  cents: number | null
  confidence: Confidence
  /** The paystub line it came from, with identifiers taken out. */
  source: string | null
}

/** What the owner reviews: every figure Leeway found, each one editable before saving. */
export interface PaystubExtraction {
  employerName: string | null
  payDate: IsoDate | null
  periodStart: IsoDate | null
  periodEnd: IsoDate | null
  payCadence: { value: PayCadence | null; confidence: Confidence; source: string | null }
  current: Record<CurrentField, ReviewFigure>
  yearToDate: Record<YearToDateField, ReviewFigure>
  /** The pension's plan name as the paystub prints it, offered as a new pension's name. */
  pensionPlanName: string | null
}

/**
 * A paycheck figure above this is surely a misread: $100,000 in one period.
 * It is the most a pension or retirement contribution may be, so a figure
 * the review allows can always be applied to one.
 */
export const MAX_PERIOD_CENTS = MAX_MONTHLY_CENTS
/** And a year-to-date figure above $1,000,000. */
export const MAX_YEAR_CENTS = 100_000_000

/** One amount as printed: "1,234.56", "1234.5" or "$275", with no sign. */
const AMOUNT = /^\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/

/**
 * A single amount as printed, in cents: "(12.50)" and "-12.50" read as
 * positive, since a deduction's sign only says which column it is in.
 */
function amountCents(printed: string): number | null {
  const plain = printed
    .trim()
    .replace(/^\((.*)\)$/, '$1')
    .replace(/^-/, '')
  if (!AMOUNT.test(plain)) return null
  return Math.round(Number(plain.replace(/[$,\s]/g, '')) * 100)
}

/**
 * An amount as printed, in cents, or null when it is not one. Two lines of
 * the same kind come joined with " + " and are added here, so the model never
 * does arithmetic.
 */
export function centsOf(printed: string): number | null {
  let total = 0
  for (const part of printed.split('+')) {
    const cents = amountCents(part)
    if (cents === null) return null
    total += cents
  }
  return total
}

/** A figure as the owner reviews it; one too large to be real is dropped. */
function reviewFigure(figure: z.infer<typeof readFigure>, max: number): ReviewFigure {
  const cents = figure.amount === null ? null : centsOf(figure.amount)
  const plausible = cents !== null && cents <= max
  return {
    cents: plausible ? cents : null,
    // A figure that was printed but could not be read is the one to look at first.
    confidence: plausible || figure.amount === null ? figure.confidence : 'low',
    source: redactSource(figure.source),
  }
}

function reviewFigures<F extends string>(
  fields: readonly F[],
  read: Record<F, z.infer<typeof readFigure>>,
  max: number,
): Record<F, ReviewFigure> {
  return Object.fromEntries(
    fields.map((field) => [field, reviewFigure(read[field], max)]),
  ) as Record<F, ReviewFigure>
}

/** A date as the reader gave it, kept only when it is a real YYYY-MM-DD day. */
function dateOf(text: string | null): IsoDate | null {
  return text !== null && isIsoDate(text) ? text : null
}

/**
 * The reading cleaned for review: amounts in cents, real dates only, and
 * every line of text redacted. Take-home pay above gross pay cannot be right,
 * so both are marked for a second look. The pension's plan name is kept only
 * when the paystub shows a pension contribution for it to name.
 */
export function extractionFrom(reading: PaystubReading): PaystubExtraction {
  const current = reviewFigures(CURRENT_FIELDS, reading.current, MAX_PERIOD_CENTS)
  const { grossPay, netPay } = current
  if (grossPay.cents !== null && netPay.cents !== null && netPay.cents > grossPay.cents) {
    grossPay.confidence = 'low'
    netPay.confidence = 'low'
  }
  return {
    employerName: redactEmployer(reading.employerName),
    payDate: dateOf(reading.payDate),
    periodStart: dateOf(reading.periodStart),
    periodEnd: dateOf(reading.periodEnd),
    payCadence: {
      value: reading.payFrequency.value,
      confidence: reading.payFrequency.confidence,
      source: redactSource(reading.payFrequency.source),
    },
    current,
    yearToDate: reviewFigures(YEAR_TO_DATE_FIELDS, reading.yearToDate, MAX_YEAR_CENTS),
    // A plan name only means something beside the contribution it labels.
    pensionPlanName:
      current.pension.cents === null ? null : redactPlanName(reading.pensionPlanName),
  }
}

/** Whether the reading found anything worth reviewing: a date or at least one amount. */
export function foundAnything(extraction: PaystubExtraction): boolean {
  const amounts = [...Object.values(extraction.current), ...Object.values(extraction.yearToDate)]
  return extraction.payDate !== null || amounts.some((figure) => figure.cents !== null)
}
