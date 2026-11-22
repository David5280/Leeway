// Paystubs for tests: the first bytes of each file type, a reading as a
// document reader returns one, and a fake reader that records every file it
// is given. No test ever sends a file to a real model.

import type { DocumentReader, ReaderError, ReaderUsage } from '../../src/ai/documents.js'
import type { PaystubFile } from '../../src/domain/paystubs/files.js'
import {
  CURRENT_FIELDS,
  YEAR_TO_DATE_FIELDS,
  type Confidence,
  type PaystubReading,
} from '../../src/domain/paystubs/reading.js'
import type { Paystub } from '../../src/domain/paystubs/paystubs.js'

/** A file of a type, its signature followed by filler up to the size asked. */
function fileOf(signature: number[], size: number, fill = 0x20): Buffer {
  const bytes = Buffer.alloc(Math.max(size, signature.length), fill)
  Buffer.from(signature).copy(bytes)
  return bytes
}

export const pdf = (size = 64) => fileOf([...Buffer.from('%PDF-1.7\n')], size)
export const png = (size = 64) => fileOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size)
export const jpeg = (size = 64) => fileOf([0xff, 0xd8, 0xff, 0xe0], size)
/** An iPhone photo: a box size, then "ftyp" and the "heic" brand. */
export const heic = (size = 64) => fileOf([0, 0, 0, 0x18, ...Buffer.from('ftypheic')], size)

/** One figure as a reader returns it. */
export function readFigure(
  amount: string | null,
  source: string | null = null,
  confidence: Confidence = 'high',
) {
  return { amount, confidence, source }
}

const NOT_SHOWN = readFigure(null)

/** Every field of a group, none of them shown on the paystub. */
function noneShown<F extends string>(fields: readonly F[]) {
  return Object.fromEntries(fields.map((field) => [field, NOT_SHOWN])) as Record<
    F,
    typeof NOT_SHOWN
  >
}

/**
 * A city employee's paystub, paid twice a month, with a pension and a 457.
 * Its lines carry the identifiers a real paystub prints, which must never
 * come back out.
 */
export const CITY_READING: PaystubReading = {
  isPaystub: true,
  employerName: 'City of Example, 1437 Bannock St, Denver CO 80202',
  payDate: '2026-11-13',
  periodStart: '2026-10-26',
  periodEnd: '2026-11-08',
  payFrequency: { value: 'semimonth', confidence: 'high', source: 'Pay Frequency: Semi-Monthly' },
  current: {
    ...noneShown(CURRENT_FIELDS),
    grossPay: readFigure('3,845.00', 'Gross Pay 3,845.00 SSN XXX-XX-6789'),
    netPay: readFigure('2,611.42', 'Net Pay 2,611.42 Deposit to acct 000123456789'),
    pension: readFigure('422.95', 'PERA Member 11.00% 422.95'),
    pensionEmployer: readFigure('822.83', 'PERA Employer 822.83', 'medium'),
    plan457: readFigure('150.00 + 50.00', 'Deferred Comp 457 150.00 / Roth 457 50.00'),
  },
  yearToDate: {
    ...noneShown(YEAR_TO_DATE_FIELDS),
    grossPay: readFigure('80,745.00', 'YTD Gross 80,745.00 Employee ID 004417'),
    pension: readFigure('8,881.95', 'YTD PERA 8,881.95'),
  },
  pensionPlanName: 'PERA',
}

/** A reading of something that is not a paystub. */
export const NOT_A_PAYSTUB: PaystubReading = {
  ...CITY_READING,
  isPaystub: false,
  employerName: null,
  payDate: null,
  periodStart: null,
  periodEnd: null,
  payFrequency: { value: null, confidence: 'low', source: null },
  current: noneShown(CURRENT_FIELDS),
  yearToDate: noneShown(YEAR_TO_DATE_FIELDS),
  pensionPlanName: null,
}

export const USAGE: ReaderUsage = {
  model: 'claude-haiku-5-5',
  inputTokens: 1_850,
  outputTokens: 640,
}

/** The input tokens a fake count gives: about a one-page PDF and the prompt. */
export const PAGE_TOKENS = 5_000

/**
 * A document reader that answers with a reading, or fails with a message,
 * and records each file it was handed, so a test sees exactly what left.
 * Counting is free, so a counted file is recorded apart from one sent.
 */
export class FakeReader implements DocumentReader {
  readonly name = 'Claude'
  readonly files: PaystubFile[] = []
  readonly counted: PaystubFile[] = []
  /** The counted tokens each read was handed, so a file is never counted twice. */
  readonly tokensGiven: number[] = []
  /** What a count gives, or the error it fails with. */
  tokens: number | Error = PAGE_TOKENS

  constructor(public answer: PaystubReading | ReaderError | Error = CITY_READING) {}

  async countPaystubTokens(file: PaystubFile) {
    this.counted.push(file)
    await new Promise((resolve) => setImmediate(resolve))
    if (this.tokens instanceof Error) throw this.tokens
    return this.tokens
  }

  async readPaystub(file: PaystubFile, inputTokens: number) {
    this.files.push(file)
    this.tokensGiven.push(inputTokens)
    // A tick, as a network call takes, so reads at the same time overlap.
    await new Promise((resolve) => setImmediate(resolve))
    if (this.answer instanceof Error) throw this.answer
    return { reading: this.answer, usage: USAGE }
  }
}

/** A paystub as the owner confirms it on the review screen. */
export function confirmedPaystub(fields: Partial<Paystub> = {}): Paystub {
  const none = <F extends string>(fields: readonly F[]) =>
    Object.fromEntries(fields.map((field) => [field, null])) as Record<F, null>
  return {
    employerName: 'City of Example',
    payDate: '2026-11-13',
    periodStart: '2026-10-26',
    periodEnd: '2026-11-08',
    payCadence: 'semimonth',
    current: {
      ...none(CURRENT_FIELDS),
      grossPay: 384_500,
      netPay: 261_142,
      pension: 42_295,
      pensionEmployer: 82_283,
      plan457: 20_000,
    },
    yearToDate: {
      ...none(YEAR_TO_DATE_FIELDS),
      grossPay: 8_074_500,
      pension: 888_195,
    },
    ...fields,
  }
}
