// Paystubs for tests: the first bytes of each file type, a reading as a
// document reader returns one, and a fake reader that records every file it
// is given. No test ever sends a file to a real model.

import { deflateSync } from 'node:zlib'
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

/** A page object's dictionary, as a PDF writes one. */
const PAGE = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'

/**
 * A PDF with pages written as plain objects numbered from 3, after its
 * catalog (1) and page tree (2). `rewritten` adds an incremental update that
 * writes the first page again under the same number, as an edit of a file does,
 * and `content` a page drawing: a stream that is not an object stream.
 */
export function pdfOfPages(count: number, { rewritten = false, content = false } = {}): Buffer {
  const numbers = Array.from({ length: count }, (_, index) => index + 3)
  const kids = numbers.map((number) => `${number} 0 R`).join(' ')
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${count} >> endobj`,
    ...numbers.map((number) => `${number} 0 obj ${PAGE} endobj`),
    ...(rewritten ? [`3 0 obj ${PAGE} endobj`] : []),
    ...(content ? ['30 0 obj << /Length 9 >>\nstream\nBT ET q Q\nendstream\nendobj'] : []),
  ]
  return Buffer.from(`%PDF-1.7\n${objects.join('\n')}\n%%EOF\n`, 'latin1')
}

/**
 * A PDF whose pages are packed into one compressed object stream, as newer
 * PDFs write them, with the page tree: a header of "number offset" pairs,
 * then the objects.
 * `length` writes the stream's /Length directly, or as a reference to
 * another object, which leaves the end to be found by "endstream".
 */
export function packedPdfOfPages(
  count: number,
  {
    length = 'direct',
    filter = '/FlateDecode',
    claimed = count + 1,
  }: { length?: 'direct' | 'reference'; filter?: string; claimed?: number | null } = {},
): Buffer {
  // The page tree (object 2) goes in with the pages, so it is read and left uncounted.
  const tree = `<< /Type /Pages /Count ${count} >>`
  const bodies = [tree, ...Array.from({ length: count }, () => PAGE)]
  let offset = 0
  const pairs = bodies.map((body, index) => {
    const pair = `${index + 2} ${offset}`
    offset += body.length + 1
    return pair
  })
  const header = `${pairs.join(' ')}\n`
  const packed = deflateSync(Buffer.from(header + bodies.join('\n'), 'latin1'))
  const lengthEntry = length === 'direct' ? `${packed.length}` : '9 0 R'
  // The count the stream claims to hold, which a damaged or crafted file may get wrong.
  const n = claimed === null ? '' : `/N ${claimed} `
  const dictionary = `<< /Type /ObjStm ${n}/First ${header.length} /Filter ${filter} /Length ${lengthEntry} >>`
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n', 'latin1'),
    Buffer.from(`20 0 obj ${dictionary}\nstream\n`, 'latin1'),
    packed,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ])
}

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
}

export const USAGE: ReaderUsage = {
  model: 'claude-haiku-5-5',
  inputTokens: 1_850,
  outputTokens: 640,
}

/**
 * A document reader that answers with a reading, or fails with a message,
 * and records each file it was handed, so a test sees exactly what left.
 */
export class FakeReader implements DocumentReader {
  readonly name = 'Claude'
  readonly files: PaystubFile[] = []

  constructor(public answer: PaystubReading | ReaderError | Error = CITY_READING) {}

  async readPaystub(file: PaystubFile) {
    this.files.push(file)
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
