// Paystub fixtures for the web's tests: a reading turned into review figures
// by the server's own code, get_paystub as the server answers it, and the
// files an owner might choose. Nothing here is ever sent to a model.

import { MAX_PAYSTUB_BYTES, PAYSTUB_TYPES } from '../../../server/src/domain/paystubs/files'
import type { SavedPaystub } from '../../../server/src/domain/paystubs/paystubs'
import {
  CURRENT_FIELDS,
  extractionFrom,
  YEAR_TO_DATE_FIELDS,
  type Confidence,
  type PaystubReading,
} from '../../../server/src/domain/paystubs/reading'
import {
  readReview,
  reviewText,
  type PaystubImport,
  type PaystubRead,
} from '../pages/plan/retirement/paystub/review'

/** The pension a paystub updates; save_paystub takes a real id. */
export const PENSION_ID = '0b9a3c1e-5f4d-4c2b-9e8a-7d6c5b4a3f21'

function readFigure(amount: string | null, source: string | null, confidence: Confidence = 'high') {
  return { amount, confidence, source }
}

/** Every field of a group, none of them on the paystub. */
function noneShown<F extends string>(fields: readonly F[]) {
  return Object.fromEntries(fields.map((field) => [field, readFigure(null, null)])) as Record<
    F,
    ReturnType<typeof readFigure>
  >
}

/**
 * A city employee's paystub, paid twice a month, with a pension and a 457.
 * The employer's pension share was hard to read, so it is the one to check.
 */
const CITY_READING: PaystubReading = {
  isPaystub: true,
  employerName: 'City of Example',
  payDate: '2026-11-13',
  periodStart: '2026-10-26',
  periodEnd: '2026-11-08',
  payFrequency: { value: 'semimonth', confidence: 'high', source: 'Pay Frequency: Semi-Monthly' },
  current: {
    ...noneShown(CURRENT_FIELDS),
    grossPay: readFigure('3,845.00', 'Gross Pay 3,845.00'),
    netPay: readFigure('2,611.42', 'Net Pay 2,611.42'),
    pension: readFigure('422.95', 'PERA Member 11.00% 422.95'),
    pensionEmployer: readFigure('822.83', 'PERA Employer 822.83', 'low'),
    plan457: readFigure('150.00 + 50.00', 'Deferred Comp 457 150.00 / Roth 457 50.00', 'medium'),
  },
  yearToDate: {
    ...noneShown(YEAR_TO_DATE_FIELDS),
    grossPay: readFigure('80,745.00', 'YTD Gross 80,745.00'),
  },
}

/** What POST /api/paystubs/read answers for the city paystub, or one changed as given. */
export function cityRead(reading: Partial<PaystubReading> = {}): PaystubRead {
  return { extraction: extractionFrom({ ...CITY_READING, ...reading }), readerName: 'Claude' }
}

/** A paystub with no 401(k), 457 or 403(b) figure, so there is no contribution to offer. */
export const noPlansRead = cityRead({
  current: { ...CITY_READING.current, plan457: readFigure(null, null) },
})

/** The upload route answering with a reading, as the server does. */
export const reads = (read: PaystubRead) => () => Response.json({ result: read })

/** The city paystub as save_paystub keeps it, its figures read back as the review screen does. */
export function savedPaystub(fields: Partial<SavedPaystub> = {}): SavedPaystub {
  const reviewed = readReview(reviewText(cityRead().extraction))
  if (!reviewed.ok) throw new Error(reviewed.error)
  return {
    id: 'f6c1e7d2-8a3b-4c5d-9e0f-1a2b3c4d5e6f',
    ...reviewed.paystub,
    pensionAccountId: null,
    savedAt: '2026-11-19T16:00:00.000Z',
    ...fields,
  }
}

/** get_paystub as the server answers it: able to read, with the newest paystub if given. */
export function paystubStatus(latest: SavedPaystub | null = null, available = true): PaystubImport {
  return {
    available,
    readerName: available ? 'Claude' : null,
    types: PAYSTUB_TYPES,
    maxBytes: MAX_PAYSTUB_BYTES,
    latest,
  }
}

/** A file the owner might choose, of a type and size. */
export function chosenFile(type = 'application/pdf', size = 2048, name = 'paystub.pdf'): File {
  const file = new File(['%PDF-1.7'], name, { type })
  // A real file of this size is slow to build, and only its size is read before sending.
  Object.defineProperty(file, 'size', { value: size })
  return file
}
