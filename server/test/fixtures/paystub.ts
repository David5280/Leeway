// Paystubs for tests: the first bytes of each file type, a reading as a
// document reader returns one, and a fake reader that records every file it
// is given. No test ever sends a file to a real model.

import type { DocumentReader, ReaderError, ReaderUsage } from '../../src/ai/documents.js'
import type { PaystubFile } from '../../src/domain/paystubs/files.js'
import {
  EARNING_LINES,
  eachField,
  EMPLOYER_LINES,
  POST_TAX_LINES,
  PRE_TAX_LINES,
  TAX_LINES,
} from '../../src/domain/paystubs/lines.js'
import {
  CURRENT_FIELDS,
  YEAR_TO_DATE_FIELDS,
  type Confidence,
  type PaystubReading,
} from '../../src/domain/paystubs/reading.js'
import type { ConfirmedDetail } from '../../src/domain/paystubs/confirmed.js'
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

/** One single figure as a reader returns it, like hours or a rate. */
export function readFigure(
  amount: string | null,
  source: string | null = null,
  confidence: Confidence = 'high',
) {
  return { amount, confidence, source }
}

/** One paystub line as a reader returns it: this period's amount and the year-to-date one. */
export function readLine(
  current: string | null,
  yearToDate: string | null = null,
  source: string | null = null,
  confidence: Confidence = 'high',
) {
  return { current, yearToDate, confidence, source }
}

/** Every line of a group, none of them shown on the paystub. */
export function noLines<F extends string>(fields: readonly F[]) {
  return eachField(fields, () => readLine(null))
}

/**
 * A city employee's paystub, paid twice a month, with a pension, a 457 and
 * its Roth side, and no Social Security (as many public employers). Its
 * lines carry the identifiers a real paystub prints, which must never come
 * back out. The figures add up: 3,845.00 gross less 1,233.58 taken out is
 * 2,611.42 take-home.
 */
export const CITY_READING: PaystubReading = {
  isPaystub: true,
  employerName: 'City of Example, 1437 Bannock St, Denver CO 80202',
  payDate: '2026-11-13',
  periodStart: '2026-10-26',
  periodEnd: '2026-11-08',
  payFrequency: { value: 'semimonth', confidence: 'high', source: 'Pay Frequency: Semi-Monthly' },
  pay: {
    gross: readLine('3,845.00', '80,745.00', 'Gross Pay 3,845.00 SSN XXX-XX-6789'),
    net: readLine('2,611.42', null, 'Net Pay 2,611.42 Deposit to acct 000123456789'),
    hours: readFigure(null),
    hourlyRate: readFigure(null),
    annualSalary: readFigure('92,280.00', 'Annual Salary 92,280.00 Employee ID 004417'),
  },
  earnings: {
    ...noLines(EARNING_LINES),
    regular: readLine('3,845.00', '80,745.00', 'Regular Salary 3,845.00'),
  },
  taxes: {
    ...noLines(TAX_LINES),
    federalIncome: readLine('350.00', '7,350.00', 'Fed Withholding 350.00'),
    stateIncome: readLine('149.88', '3,147.48', 'CO State Tax 149.88'),
    local: readLine('5.00', null, 'Denver OPT 5.00'),
    medicare: readLine('55.75', '1,170.75', 'Medicare 55.75'),
  },
  preTax: {
    ...noLines(PRE_TAX_LINES),
    pension: readLine('422.95', '8,881.95', 'PERA Member 11.00% 422.95'),
    plan457: readLine('150.00', null, 'Deferred Comp 457 150.00'),
    health: readLine('50.00', null, 'Medical Plan 50.00'),
  },
  postTax: {
    ...noLines(POST_TAX_LINES),
    roth457: readLine('50.00', null, 'Roth 457 50.00'),
  },
  employer: {
    ...noLines(EMPLOYER_LINES),
    pension: readLine('822.83', null, 'PERA Employer 822.83', 'medium'),
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
  pay: {
    gross: readLine(null),
    net: readLine(null),
    hours: readFigure(null),
    hourlyRate: readFigure(null),
    annualSalary: readFigure(null),
  },
  earnings: noLines(EARNING_LINES),
  taxes: noLines(TAX_LINES),
  preTax: noLines(PRE_TAX_LINES),
  postTax: noLines(POST_TAX_LINES),
  employer: noLines(EMPLOYER_LINES),
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

/** A line as the owner confirms it, in cents. */
export const line = (current: number | null, yearToDate: number | null = null) => ({
  current,
  yearToDate,
})

/** Every line of a group, none of them on the paystub. */
const noCents = <F extends string>(fields: readonly F[]) => eachField(fields, () => line(null))

/** The city paystub as the owner confirms it on the full review, changed as given. */
export function confirmedDetail(fields: Partial<ConfirmedDetail> = {}): ConfirmedDetail {
  return {
    employerName: 'City of Example',
    payDate: '2026-11-13',
    periodStart: '2026-10-26',
    periodEnd: '2026-11-08',
    payCadence: 'semimonth',
    pay: {
      gross: line(384_500, 8_074_500),
      net: line(261_142),
      hours: null,
      hourlyRate: null,
      annualSalary: 9_228_000,
    },
    earnings: { ...noCents(EARNING_LINES), regular: line(384_500, 8_074_500) },
    taxes: {
      ...noCents(TAX_LINES),
      federalIncome: line(35_000, 735_000),
      stateIncome: line(14_988, 314_748),
      local: line(500),
      medicare: line(5_575, 117_075),
    },
    preTax: {
      ...noCents(PRE_TAX_LINES),
      pension: line(42_295, 888_195),
      plan457: line(15_000),
      health: line(5_000),
    },
    postTax: { ...noCents(POST_TAX_LINES), roth457: line(5_000) },
    employer: { ...noCents(EMPLOYER_LINES), pension: line(82_283) },
    ...fields,
  }
}
