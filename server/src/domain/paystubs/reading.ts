// What a document reader is asked to return for a paystub, and how that is
// checked and cleaned into the figures the owner reviews. Amounts come back
// exactly as printed and are turned into cents in detail.ts, so the model
// never does arithmetic; every line of text is redacted before anything
// keeps it. Pure.
//
// A reading has every line of the paystub (lines.ts). The review keeps two
// views of it: the full detail, and the few figures the pension and
// retirement import has always used (current and yearToDate), which are
// worked out from the detail so the model is asked for each figure once.

import { z } from 'zod'
import { isIsoDate, type IsoDate } from '../../lib/dates.js'
import { PAY_CADENCES } from '../retirement/pensions.js'
import { checkedDetailFrom, type ExtractedDetail } from './detail.js'
import {
  legacyFigures,
  type CurrentField,
  type ReviewFigure,
  type YearToDateField,
} from './legacy.js'
import {
  CONFIDENCES,
  EARNING_LINES,
  EMPLOYER_LINES,
  eachField,
  POST_TAX_LINES,
  PRE_TAX_LINES,
  TAX_LINES,
  type Confidence,
  type ReviewLine,
} from './lines.js'
import { redactPlanName } from './planName.js'
import { redactEmployer, redactSource } from './redact.js'

export { CONFIDENCES, type Confidence } from './lines.js'
export { MAX_PERIOD_CENTS, MAX_YEAR_CENTS } from './detail.js'
export { centsOf } from './amounts.js'
export {
  CURRENT_FIELDS,
  YEAR_TO_DATE_FIELDS,
  type CurrentField,
  type ReviewFigure,
  type YearToDateField,
} from './legacy.js'

export type PayCadence = (typeof PAY_CADENCES)[number]

/**
 * One figure as the reader returns it: the amount as printed and the line it
 * came from. One shared object, so the output schema holds it once.
 */
const readFigure = z.object({
  amount: z.string().nullable(),
  confidence: z.enum(CONFIDENCES),
  source: z.string().nullable(),
})

/** One paystub line: this period's amount and the year-to-date one, as printed. */
const readLine = z.object({
  current: z.string().nullable(),
  yearToDate: z.string().nullable(),
  confidence: z.enum(CONFIDENCES),
  source: z.string().nullable(),
})

export type ReadFigure = z.infer<typeof readFigure>
export type ReadLine = z.infer<typeof readLine>

/** An object with one line for each field named. */
function lines<F extends string>(fields: readonly F[]) {
  return z.object(eachField(fields, () => readLine))
}

/**
 * The shape the reader must return, sent to the model as a strict output
 * schema. Kept to strings, enums and nulls: numbers and dates are checked
 * here. Every line reuses the same two objects, which keeps the schema's
 * nullable fields few, as the API limits them.
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
  pay: z.object({
    gross: readLine,
    net: readLine,
    hours: readFigure,
    hourlyRate: readFigure,
    annualSalary: readFigure,
  }),
  earnings: lines(EARNING_LINES),
  taxes: lines(TAX_LINES),
  preTax: lines(PRE_TAX_LINES),
  postTax: lines(POST_TAX_LINES),
  employer: lines(EMPLOYER_LINES),
  /** The pension line's plan name as printed, like "PERA", to name a new pension by. */
  pensionPlanName: z.string().nullable(),
})

export type PaystubReading = z.infer<typeof paystubReadingSchema>

/** What the owner reviews: every figure Leeway found, each one editable before saving. */
export interface PaystubExtraction {
  employerName: string | null
  payDate: IsoDate | null
  periodStart: IsoDate | null
  periodEnd: IsoDate | null
  payCadence: { value: PayCadence | null; confidence: Confidence; source: string | null }
  /** Every line of the paystub, for the full review (P2 onward). */
  detail: ExtractedDetail
  /** The figures the pension and retirement import uses, worked out from the detail. */
  current: Record<CurrentField, ReviewFigure>
  yearToDate: Record<YearToDateField, ReviewFigure>
  /** The pension's plan name as the paystub prints it, offered as a new pension's name. */
  pensionPlanName: string | null
}

/** A date as the reader gave it, kept only when it is a real YYYY-MM-DD day. */
function dateOf(text: string | null): IsoDate | null {
  return text !== null && isIsoDate(text) ? text : null
}

/**
 * The reading cleaned for review: amounts in cents, real dates only, and
 * every line of text redacted. The pension's plan name is kept only when the
 * paystub shows a pension contribution for it to name.
 */
export function extractionFrom(reading: PaystubReading): PaystubExtraction {
  const checked = checkedDetailFrom(reading)
  const { detail } = checked
  const { current, yearToDate } = legacyFigures(checked)
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
    detail,
    current,
    yearToDate,
    // A plan name only means something beside the contribution it labels.
    pensionPlanName:
      current.pension.cents === null ? null : redactPlanName(reading.pensionPlanName),
  }
}

/** The lines of one group, as a list. */
function linesOf(group: Record<string, ReviewLine>): ReviewLine[] {
  return Object.values(group)
}

/** Whether the reading found anything worth reviewing: a date or at least one figure. */
export function foundAnything(extraction: PaystubExtraction): boolean {
  const { pay, ...groups } = extraction.detail
  const lines = [pay.gross, pay.net, ...Object.values(groups).flatMap(linesOf)]
  const lineValues = lines.flatMap((line) => [line.current, line.yearToDate])
  const values = [pay.hours.value, pay.hourlyRate.value, pay.annualSalary.value, ...lineValues]
  return extraction.payDate !== null || values.some((value) => value !== null)
}
