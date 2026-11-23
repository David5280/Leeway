// The lines of a paystub Leeway reads in full: pay, earnings, taxes,
// deductions before and after tax, and what the employer adds. Each line has
// this period's amount and the year-to-date one. The lists here name every
// line once, so the reader's schema, the review screen and the saved figures
// all agree. Pure, and shared with the web app.

/** How sure the reader is of a figure: the owner checks a low one first. */
export const CONFIDENCES = ['high', 'medium', 'low'] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** Total pay for the period, before and after everything taken out. */
export const PAY_LINES = ['gross', 'net'] as const

/** What gross pay is made of. */
export const EARNING_LINES = ['regular', 'overtime', 'bonus', 'commission', 'other'] as const

/** Taxes withheld, by who levies them. */
export const TAX_LINES = [
  'federalIncome',
  'stateIncome',
  'local',
  'socialSecurity',
  'medicare',
  'other',
] as const

/**
 * Taken out before tax. The 401(k), 403(b) and 457 lines are the traditional
 * (pre-tax) contributions only; their Roth sides are post-tax lines. The
 * pension is the employee's own share of a defined-benefit plan.
 */
export const PRE_TAX_LINES = [
  'plan401k',
  'plan403b',
  'plan457',
  'pension',
  'hsa',
  'fsa',
  'health',
  'dental',
  'vision',
  'commuter',
  'other',
] as const

/**
 * Taken out after tax. A garnishment, levy or support order is only ever
 * "other": Leeway never names it.
 */
export const POST_TAX_LINES = ['roth401k', 'roth403b', 'roth457', 'afterTax', 'other'] as const

/** Paid by the employer on top of pay, never taken from it. */
export const EMPLOYER_LINES = ['match', 'hsa', 'pension'] as const

/** Every group of lines, in the order a paystub usually prints them. */
export const LINE_GROUPS = {
  earnings: EARNING_LINES,
  taxes: TAX_LINES,
  preTax: PRE_TAX_LINES,
  postTax: POST_TAX_LINES,
  employer: EMPLOYER_LINES,
} as const

export type LineGroup = keyof typeof LINE_GROUPS
export type PayLine = (typeof PAY_LINES)[number]
export type LineOf<G extends LineGroup> = (typeof LINE_GROUPS)[G][number]

export const GROUP_NAMES = Object.keys(LINE_GROUPS) as LineGroup[]

/** One line's two amounts in cents; null where the paystub does not print it, never 0. */
export interface CentsLine {
  current: number | null
  yearToDate: number | null
}

/** A line as the owner reviews it: its amounts, how sure the reader was, and where it came from. */
export interface ReviewLine extends CentsLine {
  confidence: Confidence
  /** The paystub line it came from, with identifiers taken out. */
  source: string | null
}

/** One figure that is not a pair of amounts, like hours worked. */
export interface ReviewValue {
  /** Cents for money; hours for hours. Null when the paystub does not show it. */
  value: number | null
  confidence: Confidence
  source: string | null
}

/** Every group's lines, each line of shape L. */
export type Groups<L> = { [G in LineGroup]: Record<LineOf<G>, L> }

/**
 * Pay itself: gross and take-home, and for hourly pay the hours and rate,
 * with the yearly salary when the paystub states one. V is how a single
 * figure is held: reviewed with its source, or confirmed as a plain number.
 */
export interface Pay<L, V> {
  gross: L
  net: L
  /** Hours paid this period, like 80 or 86.67. */
  hours: V
  /** Cents an hour. */
  hourlyRate: V
  /** Cents a year, only as the paystub states it. */
  annualSalary: V
}

/** The single figures of pay, which are not pairs of amounts. */
export const PAY_VALUES = ['hours', 'hourlyRate', 'annualSalary'] as const
export type PayValue = (typeof PAY_VALUES)[number]

/** Adds the amounts given, or null when none of them is known, so an unknown never reads as 0. */
export function sumKnown(amounts: readonly (number | null)[]): number | null {
  const known = amounts.filter((amount) => amount !== null)
  return known.length === 0 ? null : known.reduce((sum, amount) => sum + amount, 0)
}

/** Builds a record with one entry for each field named. */
export function eachField<F extends string, V>(
  fields: readonly F[],
  make: (field: F) => V,
): Record<F, V> {
  return Object.fromEntries(fields.map((field) => [field, make(field)])) as Record<F, V>
}

/** Builds every group of lines from one line maker. */
export function eachGroup<L>(
  make: <G extends LineGroup>(group: G, line: LineOf<G>) => L,
): Groups<L> {
  return eachField(GROUP_NAMES, (group) =>
    eachField(LINE_GROUPS[group] as readonly LineOf<typeof group>[], (line) => make(group, line)),
  ) as Groups<L>
}
