// The few figures the pension and retirement import has always used (gross
// and take-home pay, the pension, each workplace plan and the HSA), worked
// out from a paystub's full detail. The model is asked for each line once;
// these are sums of those lines, so the two views can never disagree. Pure.

import {
  lineAt,
  MAX_PERIOD_CENTS,
  MAX_YEAR_CENTS,
  type ExtractedDetail,
  type LinePath,
} from './detail.js'
import { eachField, sumKnown, type CentsLine, type Confidence, type ReviewLine } from './lines.js'
import { MAX_SOURCE_LENGTH } from './redact.js'

/** This period's figures the pension and retirement import uses. */
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

/** One figure ready for review: cents, or null when the paystub does not show it. */
export interface ReviewFigure {
  cents: number | null
  confidence: Confidence
  /** The paystub line it came from, with identifiers taken out. */
  source: string | null
}

/** The lower of two confidences, so a figure built from two lines is as sure as its weakest. */
function lower(a: Confidence, b: Confidence): Confidence {
  const order: Confidence[] = ['low', 'medium', 'high']
  return order[Math.min(order.indexOf(a), order.indexOf(b))]!
}

/**
 * The lines each figure of the pension and retirement import adds up. A
 * plan's figure takes in its Roth side, as that import always has.
 */
export const LEGACY_PARTS: Record<CurrentField, readonly LinePath[]> = {
  grossPay: [['pay', 'gross']],
  netPay: [['pay', 'net']],
  pension: [['preTax', 'pension']],
  pensionEmployer: [['employer', 'pension']],
  plan401k: [
    ['preTax', 'plan401k'],
    ['postTax', 'roth401k'],
  ],
  plan457: [
    ['preTax', 'plan457'],
    ['postTax', 'roth457'],
  ],
  plan403b: [
    ['preTax', 'plan403b'],
    ['postTax', 'roth403b'],
  ],
  hsa: [['preTax', 'hsa']],
}

/** A figure's cents from its lines in one column; null when none shows it, or the total is too large. */
export function legacyCents(
  lines: readonly CentsLine[],
  column: keyof CentsLine,
  max: number,
): number | null {
  const cents = sumKnown(lines.map((line) => line[column]))
  return cents !== null && cents > max ? null : cents
}

/** One import figure for review, from its lines in one column. */
function legacyFigure(
  lines: readonly ReviewLine[],
  column: keyof CentsLine,
  max: number,
): ReviewFigure {
  const cents = legacyCents(lines, column, max)
  const shown = lines.filter((line) => line[column] !== null)
  // Sure as the weakest line it adds; a total too large to be real is the one to check.
  const confidence = (shown.length > 0 ? shown : lines).map((line) => line.confidence).reduce(lower)
  const tooLarge = cents === null && shown.length > 0
  const sources = [...new Set(shown.map((line) => line.source).filter((text) => text !== null))]
  return {
    cents,
    confidence: tooLarge ? 'low' : confidence,
    source: sources.length === 0 ? null : sources.join(' + ').slice(0, MAX_SOURCE_LENGTH).trim(),
  }
}

/** The figures the pension and retirement import uses, worked out from the full detail. */
export function legacyFigures(detail: ExtractedDetail): {
  current: Record<CurrentField, ReviewFigure>
  yearToDate: Record<YearToDateField, ReviewFigure>
} {
  const linesOf = (field: CurrentField) => LEGACY_PARTS[field].map((path) => lineAt(detail, path))
  return {
    current: eachField(CURRENT_FIELDS, (field) =>
      legacyFigure(linesOf(field), 'current', MAX_PERIOD_CENTS),
    ),
    yearToDate: eachField(YEAR_TO_DATE_FIELDS, (field) =>
      legacyFigure(linesOf(field), 'yearToDate', MAX_YEAR_CENTS),
    ),
  }
}
