// The few figures the pension and retirement import has always used (gross
// and take-home pay, the pension, each workplace plan and the HSA), worked
// out from a paystub's full detail. The model is asked for each line once;
// these are sums of those lines, so the two views can never disagree. Pure.

import {
  lineAt,
  MAX_PERIOD_CENTS,
  MAX_YEAR_CENTS,
  type CheckedDetail,
  type Dropped,
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

/** One line an import figure adds, with which of its columns lost a printed amount. */
interface Part {
  line: ReviewLine
  dropped: Dropped
}

/** One import figure for review, from its lines in one column. */
function legacyFigure(parts: readonly Part[], column: keyof CentsLine, max: number): ReviewFigure {
  const lines = parts.map((part) => part.line)
  const dropped = parts.some((part) => part.dropped[column])
  // The lines the figure rests on: those with an amount, and those that lost one.
  const used = parts
    .filter((part) => part.line[column] !== null || part.dropped[column])
    .map((part) => part.line)
  const sources = [...new Set(used.map((line) => line.source).filter((text) => text !== null))]
  const source =
    sources.length === 0 ? null : sources.join(' + ').slice(0, MAX_SOURCE_LENGTH).trim()
  // A sum missing a part would save too little without a word, so there is
  // no figure, only one to check. So too for a total too large to be real.
  const cents = dropped ? null : legacyCents(lines, column, max)
  if (cents === null && used.length > 0) return { cents, confidence: 'low', source }
  // Otherwise as sure as the weakest line it adds.
  const confidence = (used.length > 0 ? used : lines).map((line) => line.confidence).reduce(lower)
  return { cents, confidence, source }
}

/** The figures the pension and retirement import uses, worked out from the full detail. */
export function legacyFigures({ detail, dropped }: CheckedDetail): {
  current: Record<CurrentField, ReviewFigure>
  yearToDate: Record<YearToDateField, ReviewFigure>
} {
  const linesOf = (field: CurrentField) =>
    LEGACY_PARTS[field].map((path) => ({
      line: lineAt(detail, path),
      dropped: lineAt(dropped, path),
    }))
  return {
    current: eachField(CURRENT_FIELDS, (field) =>
      legacyFigure(linesOf(field), 'current', MAX_PERIOD_CENTS),
    ),
    yearToDate: eachField(YEAR_TO_DATE_FIELDS, (field) =>
      legacyFigure(linesOf(field), 'yearToDate', MAX_YEAR_CENTS),
    ),
  }
}
