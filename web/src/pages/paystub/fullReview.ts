// The full paystub review as text and back: every line Claude read, turned
// into what the inputs show, and the owner's edits read back into the
// paystub save_paystub_detail keeps. Pure, so every rule is tested alone. A
// blank figure means "not on this paystub" (null), never zero.

import type { Input } from '../../api/client'
import { parseMoney } from '../../lib/format'
import { typedAmount } from '../../lib/money'
import {
  eachField,
  GROUP_NAMES,
  LINE_GROUPS,
  PAY_LINES,
  type CentsLine,
  type LineGroup,
  type LineOf,
  type PayLine,
  type PayValue,
} from '../../../../server/src/domain/paystubs/lines'
import type { Extraction, ReviewText } from '../plan/retirement/paystub/review'
import { LINE_LABELS, PAY_LABELS } from './labels'

export type ConfirmedDetail = Input<'save_paystub_detail'>['detail']

/** One line as typed: this period's amount and the year-to-date one. */
export interface LineText {
  current: string
  yearToDate: string
}

/** The paystub's own details, as the shared details fields edit them. */
export type HeaderText = Pick<
  ReviewText,
  'employerName' | 'payDate' | 'periodStart' | 'periodEnd' | 'payCadence'
>

/** Every field of the full review as the owner's text. */
export interface FullText extends HeaderText {
  pay: Record<PayLine, LineText> & Record<PayValue, string>
  groups: { [G in LineGroup]: Record<LineOf<G>, LineText> }
}

/** Cents as the dollars a person types, to the cent: 384500 is "3845.00". */
const centsText = (cents: number | null) => (cents === null ? '' : typedAmount(cents))

const lineText = (line: CentsLine): LineText => ({
  current: centsText(line.current),
  yearToDate: centsText(line.yearToDate),
})

/** The review's text for what Claude read. */
export function fullText(extraction: Extraction): FullText {
  const { detail } = extraction
  return {
    employerName: extraction.employerName ?? '',
    payDate: extraction.payDate ?? '',
    periodStart: extraction.periodStart ?? '',
    periodEnd: extraction.periodEnd ?? '',
    payCadence: extraction.payCadence.value ?? '',
    pay: {
      gross: lineText(detail.pay.gross),
      net: lineText(detail.pay.net),
      // Hours are not money: shown as Claude read them, like 86.67.
      hours: detail.pay.hours.value === null ? '' : String(detail.pay.hours.value),
      hourlyRate: centsText(detail.pay.hourlyRate.value),
      annualSalary: centsText(detail.pay.annualSalary.value),
    },
    groups: eachField(GROUP_NAMES, (group) =>
      eachField(LINE_GROUPS[group] as readonly string[], (line) =>
        lineText((detail[group] as Record<string, CentsLine>)[line]!),
      ),
    ) as FullText['groups'],
  }
}

/** Hours as typed, to the hundredth: "80", "86.67". */
const HOURS = /^\d{1,3}(?:\.\d{1,2})?$/

/** A field read back: its value, or null when blank, or the words for what is wrong with it. */
type Read = { value: number | null } | { error: string }

function readMoney(typed: string, name: string): Read {
  const text = typed.trim()
  if (text === '') return { value: null }
  const cents = parseMoney(text)
  // parseMoney keeps a minus sign, and a paystub figure is never below zero.
  return cents === null || cents < 0 ? { error: `Enter ${name} as an amount.` } : { value: cents }
}

function readHours(typed: string): Read {
  const text = typed.trim()
  if (text === '') return { value: null }
  return HOURS.test(text) ? { value: Number(text) } : { error: 'Enter hours as a number, like 80.' }
}

/**
 * Reads every field, keeping the first problem found. When `strict` is off,
 * a field that cannot be read counts as blank, so the key figures can update
 * while the owner is still typing.
 */
function readAll(
  text: FullText,
  strict: boolean,
): { detail: ConfirmedDetail; error: string | null } {
  let error: string | null = null
  const take = (read: Read) => {
    if ('error' in read) {
      error ??= read.error
      return null
    }
    return read.value
  }
  const line = (typed: LineText, label: string): CentsLine => ({
    current: take(readMoney(typed.current, `${label} for this paycheck`)),
    yearToDate: take(readMoney(typed.yearToDate, `${label} for the year to date`)),
  })
  const detail: ConfirmedDetail = {
    employerName: text.employerName.trim() || null,
    payDate: text.payDate || null,
    periodStart: text.periodStart || null,
    periodEnd: text.periodEnd || null,
    payCadence: text.payCadence || null,
    pay: {
      ...eachField(PAY_LINES, (name) => line(text.pay[name], PAY_LABELS[name])),
      hours: take(readHours(text.pay.hours)),
      hourlyRate: take(readMoney(text.pay.hourlyRate, PAY_LABELS.hourlyRate)),
      annualSalary: take(readMoney(text.pay.annualSalary, PAY_LABELS.annualSalary)),
    },
    ...(eachField(GROUP_NAMES, (group) =>
      eachField(LINE_GROUPS[group] as readonly string[], (name) =>
        line(
          (text.groups[group] as Record<string, LineText>)[name]!,
          (LINE_LABELS[group] as Record<string, string>)[name]!,
        ),
      ),
    ) as Omit<ConfirmedDetail, 'pay' | keyof HeaderText>),
  }
  return { detail, error: strict ? error : null }
}

/** The review read back: the paystub to save, or the first thing to fix. */
export type FullRead = { ok: true; detail: ConfirmedDetail } | { ok: false; error: string }

/**
 * The review read back for saving. The server checks the ranges again; take-
 * home pay above gross pay is caught here first, in words the owner can act on.
 */
export function readFull(text: FullText): FullRead {
  const { detail, error } = readAll(text, true)
  if (error !== null) return { ok: false, error }
  const { gross, net } = detail.pay
  if (gross.current !== null && net.current !== null && net.current > gross.current) {
    return { ok: false, error: 'Take-home pay cannot be more than gross pay. Check both.' }
  }
  return { ok: true, detail }
}

/** The figures as typed so far, any that cannot be read yet left blank, for the key figures. */
export function liveDetail(text: FullText): ConfirmedDetail {
  return readAll(text, false).detail
}
