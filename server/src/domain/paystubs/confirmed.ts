// A paystub as the owner confirmed it on the full review: who paid, when,
// and every line in cents. This is the shape later steps read to apply the
// figures across Leeway. The paystub record the pension and retirement
// import keeps is worked out from it here, so the two always agree. Pure.

import { z } from 'zod'
import { formatWholeCents } from '../../lib/money.js'
import { isoDateSchema } from '../../lib/schemas.js'
import { PAY_CADENCES } from '../retirement/pensions.js'
import {
  lineAt,
  MAX_HOURS,
  MAX_PERIOD_CENTS,
  MAX_RATE_CENTS,
  MAX_YEAR_CENTS,
  type HasLines,
} from './detail.js'
import { CURRENT_FIELDS, LEGACY_PARTS, legacyCents, YEAR_TO_DATE_FIELDS } from './legacy.js'
import { eachField, LINE_GROUPS, type CentsLine, type LineGroup, type LineOf } from './lines.js'
import type { Paystub } from './paystubs.js'
import { MAX_EMPLOYER_LENGTH } from './redact.js'

/** Whole cents up to `max`, or null when the paystub does not show it. */
const upTo = (max: number) =>
  z
    .number()
    .int('Use whole cents')
    .min(0, 'A figure cannot be negative')
    .max(max, `Use ${formatWholeCents(max)} or less`)
    .nullable()

/** One confirmed line: this period's cents and the year-to-date cents. */
const centsLine = z.object({
  current: upTo(MAX_PERIOD_CENTS),
  yearToDate: upTo(MAX_YEAR_CENTS),
})

/** One group's lines, every one required so nothing is left out by mistake. */
function groupSchema<G extends LineGroup>(group: G) {
  return z.object(eachField(LINE_GROUPS[group] as readonly LineOf<G>[], () => centsLine))
}

/** Hours to the hundredth, like 86.67: not money, so not cents. */
const hours = z
  .number()
  .min(0, 'Hours cannot be negative')
  .max(MAX_HOURS, `Use ${MAX_HOURS} hours or less`)
  // Checked with a tolerance, since 86.67 is not exact in floating point.
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    'Use hours to the hundredth',
  )
  .nullable()

/** The paystub as the owner confirmed it, in full. */
export const confirmedDetailSchema = z
  .object({
    employerName: z.string().trim().max(MAX_EMPLOYER_LENGTH).nullable(),
    payDate: isoDateSchema.nullable(),
    periodStart: isoDateSchema.nullable(),
    periodEnd: isoDateSchema.nullable(),
    payCadence: z.enum(PAY_CADENCES).nullable(),
    pay: z.object({
      gross: centsLine,
      net: centsLine,
      hours,
      hourlyRate: upTo(MAX_RATE_CENTS),
      annualSalary: upTo(MAX_YEAR_CENTS),
    }),
    earnings: groupSchema('earnings'),
    taxes: groupSchema('taxes'),
    preTax: groupSchema('preTax'),
    postTax: groupSchema('postTax'),
    employer: groupSchema('employer'),
  })
  .refine(
    ({ pay }) =>
      pay.gross.current === null ||
      pay.net.current === null ||
      pay.net.current <= pay.gross.current,
    { message: 'Take-home pay cannot be more than gross pay', path: ['pay', 'net', 'current'] },
  )

/** Every line of a confirmed paystub. Amounts are cents; hours are hours. */
export type ConfirmedDetail = z.infer<typeof confirmedDetailSchema>

/**
 * The paystub record the pension and retirement import keeps, worked out
 * from the confirmed lines: each figure is the sum of the lines it is made
 * of (legacy.ts), so a 401(k) takes in its Roth side.
 */
export function paystubFromDetail(detail: ConfirmedDetail): Paystub {
  const lines = detail as HasLines<CentsLine>
  const figure = (field: (typeof CURRENT_FIELDS)[number], column: keyof CentsLine, max: number) =>
    legacyCents(
      LEGACY_PARTS[field].map((path) => lineAt(lines, path)),
      column,
      max,
    )
  return {
    employerName: detail.employerName,
    payDate: detail.payDate,
    periodStart: detail.periodStart,
    periodEnd: detail.periodEnd,
    payCadence: detail.payCadence,
    current: eachField(CURRENT_FIELDS, (field) => figure(field, 'current', MAX_PERIOD_CENTS)),
    yearToDate: eachField(YEAR_TO_DATE_FIELDS, (field) =>
      figure(field, 'yearToDate', MAX_YEAR_CENTS),
    ),
  }
}
