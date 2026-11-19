// The paystub review screen as text and back: the figures Claude read,
// turned into what the inputs show, and the owner's edits read back into the
// paystub save_paystub keeps. Also the check a chosen file gets before it is
// sent. Pure, so every rule is tested alone. A blank figure means "not on
// this paystub" (null), never zero.

import type { Input, Output } from '../../../../api/client'
import { parseMoney } from '../../../../lib/format'
import { typedAmount } from '../../../../lib/money'
import type { RetirementView } from '../fields'
import {
  HEIC_HELP,
  MAX_PAYSTUB_BYTES,
  MAX_UPLOAD_BYTES,
  PAYSTUB_TYPES,
  tooLargeMessage,
  UNSUPPORTED,
  type PaystubMediaType,
} from '../../../../../../server/src/domain/paystubs/files'
import type { PaystubRead } from '../../../../../../server/src/domain/paystubs/reader'
import type {
  Confidence,
  CurrentField,
  PayCadence,
  YearToDateField,
} from '../../../../../../server/src/domain/paystubs/reading'

export type { CurrentField, PaystubRead }
export type Extraction = PaystubRead['extraction']
export type Paystub = Input<'save_paystub'>['paystub']
export type PaystubImport = Output<'get_paystub'>

/** A pension the figures can go to. */
export interface PensionChoice {
  accountId: string
  name: string
}

/** The pensions a paystub can update, as the projection names them. */
export function pensionChoices(view: Pick<RetirementView, 'plan'>): PensionChoice[] {
  return view.plan.pensions.map(({ accountId, name }) => ({ accountId, name }))
}

/** This period's figures, in the order a paystub prints them. */
export const CURRENT_LABELS: Record<CurrentField, string> = {
  grossPay: 'Gross pay',
  netPay: 'Take-home pay',
  pension: 'Pension, your share',
  pensionEmployer: 'Pension, paid by your employer',
  plan401k: '401(k)',
  plan457: '457',
  plan403b: '403(b)',
  hsa: 'HSA',
}

/** The year-to-date figures: the same, less the employer's pension share. */
export const YEAR_TO_DATE_LABELS: Record<YearToDateField, string> = {
  grossPay: 'Gross pay',
  netPay: 'Take-home pay',
  pension: 'Pension, your share',
  plan401k: '401(k)',
  plan457: '457',
  plan403b: '403(b)',
  hsa: 'HSA',
}

const CURRENT_FIELDS = Object.keys(CURRENT_LABELS) as CurrentField[]
const YEAR_TO_DATE_FIELDS = Object.keys(YEAR_TO_DATE_LABELS) as YearToDateField[]

/** How sure Claude was of a figure, in words; a low one is the one to check first. */
export const CONFIDENCE_WORDS: Record<Confidence, string> = {
  high: 'Read clearly',
  medium: 'Check this',
  low: 'Check closely',
}

export const CADENCE_WORDS: Record<PayCadence, string> = {
  week: 'Every week',
  biweek: 'Every 2 weeks',
  semimonth: 'Twice a month',
  month: 'Monthly',
}

/** Every field of the review screen as the owner's text. */
export interface ReviewText {
  employerName: string
  payDate: string
  periodStart: string
  periodEnd: string
  /** '' when the paystub did not say. */
  payCadence: '' | PayCadence
  current: Record<CurrentField, string>
  yearToDate: Record<YearToDateField, string>
}

/** Cents as the dollars a person types, to the cent: 384500 is "3845.00". */
function centsText(cents: number | null): string {
  return cents === null ? '' : typedAmount(cents)
}

function figuresText<F extends string>(
  fields: readonly F[],
  figures: Record<F, { cents: number | null }>,
): Record<F, string> {
  return Object.fromEntries(
    fields.map((field) => [field, centsText(figures[field].cents)]),
  ) as Record<F, string>
}

/** The review screen's text for what Claude read. */
export function reviewText(extraction: Extraction): ReviewText {
  return {
    employerName: extraction.employerName ?? '',
    payDate: extraction.payDate ?? '',
    periodStart: extraction.periodStart ?? '',
    periodEnd: extraction.periodEnd ?? '',
    payCadence: extraction.payCadence.value ?? '',
    current: figuresText(CURRENT_FIELDS, extraction.current),
    yearToDate: figuresText(YEAR_TO_DATE_FIELDS, extraction.yearToDate),
  }
}

/** The review read back: the paystub to save, or the first figure that is not an amount. */
export type ReviewRead = { ok: true; paystub: Paystub } | { ok: false; error: string }

/**
 * Reads each figure in a group, naming the first that is not an amount. The
 * server checks the ranges and that take-home pay is not above gross pay.
 */
function readFigures<F extends string>(
  fields: readonly F[],
  text: Record<F, string>,
  labels: Record<F, string>,
  group: string,
): { cents: Record<F, number | null>; error: string | null } {
  let error: string | null = null
  const cents = Object.fromEntries(
    fields.map((field) => {
      const typed = text[field].trim()
      if (typed === '') return [field, null]
      const value = parseMoney(typed)
      // parseMoney keeps a minus sign, and a paystub figure is never below zero.
      if (value === null || value < 0) error ??= `Enter ${group} ${labels[field]} as an amount.`
      return [field, value]
    }),
  ) as Record<F, number | null>
  return { cents, error }
}

export function readReview(text: ReviewText): ReviewRead {
  const current = readFigures(CURRENT_FIELDS, text.current, CURRENT_LABELS, "this paycheck's")
  const yearToDate = readFigures(
    YEAR_TO_DATE_FIELDS,
    text.yearToDate,
    YEAR_TO_DATE_LABELS,
    'the year-to-date',
  )
  const error = current.error ?? yearToDate.error
  if (error !== null) return { ok: false, error }
  return {
    ok: true,
    paystub: {
      employerName: text.employerName.trim() || null,
      payDate: text.payDate || null,
      periodStart: text.periodStart || null,
      periodEnd: text.periodEnd || null,
      payCadence: text.payCadence || null,
      current: current.cents,
      yearToDate: yearToDate.cents,
    },
  }
}

/** Whether a paystub shows a 401(k), 457 or 403(b) figure, which can become the monthly contribution. */
export function showsPlanFigures(text: ReviewText): boolean {
  return [text.current.plan401k, text.current.plan457, text.current.plan403b].some(
    (typed) => typed.trim() !== '',
  )
}

/** A chosen file's type, as the browser names it, when it is one Leeway reads. */
function knownType(type: string): PaystubMediaType | undefined {
  return PAYSTUB_TYPES.find((known) => known === type)
}

/**
 * What is wrong with a chosen file before it is sent, in the server's own
 * words, or null when it may go. The browser's word for the type is only a
 * hint (the server reads the bytes), so a file with no type is sent and the
 * server decides.
 */
export function fileProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (file.size === 0) return 'The file is empty.'
  if (/^image\/hei[cf]$/.test(file.type)) return HEIC_HELP
  const known = knownType(file.type)
  if (file.type !== '' && !known) return UNSUPPORTED
  const limit = known ? MAX_PAYSTUB_BYTES[known] : MAX_UPLOAD_BYTES
  return file.size > limit ? tooLargeMessage(known) : null
}

/** What the file input offers: the types Leeway reads, by type and by name. */
export const ACCEPT = [...PAYSTUB_TYPES, '.pdf', '.png', '.jpg', '.jpeg'].join(',')
