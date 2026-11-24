// Paystub fixtures for the web's tests: a reading turned into review figures
// by the server's own code, get_paystub as the server answers it, and the
// files an owner might choose. Nothing here is ever sent to a model.

import { MAX_PAYSTUB_BYTES, PAYSTUB_TYPES } from '../../../server/src/domain/paystubs/files'
import type { SavedPaystub } from '../../../server/src/domain/paystubs/paystubs'
import type { PaystubUse } from '../../../server/src/domain/paystubs/use'
import { todayIn } from '../lib/dates'
import {
  EARNING_LINES,
  eachField,
  EMPLOYER_LINES,
  POST_TAX_LINES,
  PRE_TAX_LINES,
  TAX_LINES,
} from '../../../server/src/domain/paystubs/lines'
import {
  extractionFrom,
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

function readLine(
  current: string | null,
  yearToDate: string | null = null,
  source: string | null = null,
  confidence: Confidence = 'high',
) {
  return { current, yearToDate, confidence, source }
}

/** Every line of a group, none of them on the paystub. */
const noLines = <F extends string>(fields: readonly F[]) => eachField(fields, () => readLine(null))

/**
 * A city employee's paystub, paid twice a month, with a pension, a 457 and
 * its Roth side. The employer's pension share was hard to read, so it is the
 * one to check; the Roth line's label was unclear.
 */
const CITY_READING: PaystubReading = {
  isPaystub: true,
  employerName: 'City of Example',
  payDate: '2026-11-13',
  periodStart: '2026-10-26',
  periodEnd: '2026-11-08',
  payFrequency: { value: 'semimonth', confidence: 'high', source: 'Pay Frequency: Semi-Monthly' },
  pay: {
    gross: readLine('3,845.00', '80,745.00', 'Gross Pay 3,845.00'),
    net: readLine('2,611.42', null, 'Net Pay 2,611.42'),
    hours: readFigure(null, null),
    hourlyRate: readFigure(null, null),
    annualSalary: readFigure('92,280.00', 'Annual Salary 92,280.00'),
  },
  earnings: {
    ...noLines(EARNING_LINES),
    regular: readLine('3,845.00', '80,745.00', 'Regular 3,845.00'),
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
    pension: readLine('422.95', null, 'PERA Member 11.00% 422.95'),
    plan457: readLine('150.00', null, 'Deferred Comp 457 150.00'),
    health: readLine('50.00', null, 'Medical Plan 50.00'),
  },
  postTax: {
    ...noLines(POST_TAX_LINES),
    roth457: readLine('50.00', null, 'Roth 457 50.00', 'medium'),
  },
  employer: {
    ...noLines(EMPLOYER_LINES),
    pension: readLine('822.83', null, 'PERA Employer 822.83', 'low'),
  },
  pensionPlanName: 'PERA',
}

/** What POST /api/paystubs/read answers for the city paystub, or one changed as given. */
export function cityRead(reading: Partial<PaystubReading> = {}): PaystubRead {
  return { extraction: extractionFrom({ ...CITY_READING, ...reading }), readerName: 'Claude' }
}

/** A paystub with no 401(k), 457 or 403(b) figure, so there is no contribution to offer. */
export const noPlansRead = cityRead({
  preTax: { ...CITY_READING.preTax, plan457: readLine(null) },
  postTax: noLines(POST_TAX_LINES),
})

/** A paystub with no pension line at all, so there is no pension to add from it. */
export const noPensionRead = cityRead({
  preTax: { ...CITY_READING.preTax, pension: readLine(null) },
  employer: noLines(EMPLOYER_LINES),
  pensionPlanName: null,
})

/** A paystub with an after-tax "other" line printed but unreadable, so it is low with no amount. */
export const unreadableOtherRead = cityRead({
  postTax: { ...CITY_READING.postTax, other: readLine('1,2?4.00', null, 'Garnishment 1,2?4.00') },
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

/** This year where the test owner lives, so withholding reads as "so far this year" in any year. */
export const THIS_YEAR = Number(todayIn('America/Denver', new Date()).slice(0, 4))

/**
 * get_paystub_use for the city paystub confirmed in full and in use, its
 * take-home standing for the paycheck the bank shows; or changed as given.
 */
export function paystubInUse(fields: Partial<PaystubUse> = {}): PaystubUse {
  return {
    state: 'used',
    paidOn: '2026-11-13',
    takeHomeCents: 261_142,
    appliedToPay: true,
    figures: {
      paidOn: '2026-11-13',
      yearlyGross: { cents: 9_228_000, basis: 'frequency' },
      taxes: {
        year: THIS_YEAR,
        federalWithheldCents: 735_000,
        stateWithheldCents: 314_748,
        effectiveRate: { rate: 0.1458, basis: 'current' },
      },
      retirement: { rate: 0.376, basis: 'current', employeeCents: 62_295, employerCents: 82_283 },
      matchMonthlyCents: 12_500,
    },
    ...fields,
  }
}

/** get_paystub_use before any paystub is saved. */
export const NO_PAYSTUB_IN_USE: PaystubUse = {
  state: 'none',
  paidOn: null,
  takeHomeCents: null,
  appliedToPay: false,
  figures: null,
}
