import { describe, expect, it } from 'vitest'
import {
  HEIC_HELP,
  MAX_PAYSTUB_BYTES,
  MAX_UPLOAD_BYTES,
  UNSUPPORTED,
} from '../../../../../../server/src/domain/paystubs/files'
import { paystubSchema } from '../../../../../../server/src/domain/paystubs/paystubs'
import { cityRead } from '../../../../test/paystub'
import { pension } from '../../../../test/profile'
import { retirementOf } from '../../../../test/planning'
import {
  ACCEPT,
  fileProblem,
  pensionChoices,
  readReview,
  reviewText,
  showsPlanFigures,
  type ReviewText,
} from './review'

const city = () => reviewText(cityRead().extraction)

/** The city paystub's review text with some figures changed, as the owner typed them. */
function typed(current: Partial<ReviewText['current']>, rest: Partial<ReviewText> = {}) {
  const text = city()
  return { ...text, ...rest, current: { ...text.current, ...current } }
}

describe('reviewText', () => {
  it('shows each figure in dollars to the cent, and a blank for one the paystub did not show', () => {
    const text = city()
    expect(text).toMatchObject({
      employerName: 'City of Example',
      payDate: '2026-11-13',
      periodStart: '2026-10-26',
      periodEnd: '2026-11-08',
      payCadence: 'semimonth',
    })
    expect(text.current).toEqual({
      grossPay: '3845.00',
      netPay: '2611.42',
      pension: '422.95',
      pensionEmployer: '822.83',
      plan401k: '',
      // Two 457 lines, added on the server so the model never does arithmetic.
      plan457: '200.00',
      plan403b: '',
      hsa: '',
    })
    expect(text.yearToDate.grossPay).toBe('80745.00')
    expect(text.yearToDate.hsa).toBe('')
  })

  it('leaves every detail blank when the paystub showed none', () => {
    const text = reviewText(
      cityRead({
        employerName: null,
        payDate: null,
        periodStart: null,
        periodEnd: null,
        payFrequency: { value: null, confidence: 'low', source: null },
      }).extraction,
    )
    expect(text).toMatchObject({
      employerName: '',
      payDate: '',
      periodStart: '',
      periodEnd: '',
      payCadence: '',
    })
  })
})

describe('readReview', () => {
  it('reads the figures back as the cents save_paystub takes', () => {
    const read = readReview(city())
    expect(read).toEqual({
      ok: true,
      paystub: {
        employerName: 'City of Example',
        payDate: '2026-11-13',
        periodStart: '2026-10-26',
        periodEnd: '2026-11-08',
        payCadence: 'semimonth',
        current: {
          grossPay: 384_500,
          netPay: 261_142,
          pension: 42_295,
          pensionEmployer: 82_283,
          plan401k: null,
          plan457: 20_000,
          plan403b: null,
          hsa: null,
        },
        yearToDate: {
          grossPay: 8_074_500,
          netPay: null,
          pension: null,
          plan401k: null,
          plan457: null,
          plan403b: null,
          hsa: null,
        },
      },
    })
    // What the screen sends is a paystub the server would keep.
    expect(read.ok && paystubSchema.safeParse(read.paystub).success).toBe(true)
  })

  it('takes amounts as people type them', () => {
    const read = readReview(typed({ grossPay: ' $3,900 ', hsa: '75.5' }))
    expect(read.ok && read.paystub.current).toMatchObject({ grossPay: 390_000, hsa: 7_550 })
  })

  it('turns blank details into null, trimming the employer', () => {
    const read = readReview(
      typed(
        {},
        { employerName: '   ', payDate: '', periodStart: '', periodEnd: '', payCadence: '' },
      ),
    )
    expect(read.ok && read.paystub).toMatchObject({
      employerName: null,
      payDate: null,
      periodStart: null,
      periodEnd: null,
      payCadence: null,
    })
    const named = readReview(typed({}, { employerName: '  City of Example  ' }))
    expect(named.ok && named.paystub.employerName).toBe('City of Example')
  })

  it('names the first paycheck figure that is not an amount', () => {
    expect(readReview(typed({ netPay: 'unknown', hsa: '1.2.3' }))).toEqual({
      ok: false,
      error: "Enter this paycheck's Take-home pay as an amount.",
    })
  })

  it('refuses a figure below zero, which no paystub prints', () => {
    expect(readReview(typed({ pension: '-422.95' }))).toEqual({
      ok: false,
      error: "Enter this paycheck's Pension, your share as an amount.",
    })
  })

  it('names a year-to-date figure in its own words', () => {
    const text = city()
    const read = readReview({ ...text, yearToDate: { ...text.yearToDate, hsa: 'lots' } })
    expect(read).toEqual({ ok: false, error: 'Enter the year-to-date HSA as an amount.' })
  })
})

describe('showsPlanFigures', () => {
  it('is true when any of the 401(k), 457 or 403(b) has a figure', () => {
    expect(showsPlanFigures(city())).toBe(true)
    expect(showsPlanFigures(typed({ plan457: '', plan401k: '100' }))).toBe(true)
    expect(showsPlanFigures(typed({ plan457: '', plan403b: '50' }))).toBe(true)
  })

  it('is false when all three are blank, an HSA aside', () => {
    expect(showsPlanFigures(typed({ plan457: '  ', hsa: '75.00' }))).toBe(false)
  })
})

describe('fileProblem', () => {
  const file = (type: string, size: number) => ({ type, size })

  it('lets a PDF, PNG or JPEG within its limit through', () => {
    expect(fileProblem(file('application/pdf', MAX_PAYSTUB_BYTES['application/pdf']))).toBeNull()
    expect(fileProblem(file('image/png', 1024))).toBeNull()
    expect(fileProblem(file('image/jpeg', MAX_PAYSTUB_BYTES['image/jpeg']))).toBeNull()
  })

  it('refuses an empty file', () => {
    expect(fileProblem(file('application/pdf', 0))).toBe('The file is empty.')
  })

  it('explains how to send an iPhone photo instead of a HEIC one', () => {
    expect(fileProblem(file('image/heic', 1024))).toBe(HEIC_HELP)
    expect(fileProblem(file('image/heif', 1024))).toBe(HEIC_HELP)
  })

  it('refuses a type Leeway does not read, in the server words', () => {
    expect(fileProblem(file('text/plain', 1024))).toBe(UNSUPPORTED)
    expect(fileProblem(file('image/gif', 1024))).toBe(UNSUPPORTED)
  })

  it('refuses a photo over the photo limit, naming that limit', () => {
    const over = MAX_PAYSTUB_BYTES['image/png'] + 1
    expect(fileProblem(file('image/png', over))).toMatch(/5 MB/)
    expect(fileProblem(file('application/pdf', over))).toBeNull()
  })

  it('sends a file the browser could not name, unless it is over the upload limit', () => {
    expect(fileProblem(file('', 1024))).toBeNull()
    expect(fileProblem(file('', MAX_UPLOAD_BYTES + 1))).toMatch(/10 MB/)
  })
})

describe('the file input', () => {
  it('offers the types Leeway reads, by type and by name, and never HEIC', () => {
    expect(ACCEPT.split(',')).toEqual(
      expect.arrayContaining(['application/pdf', 'image/png', 'image/jpeg', '.pdf', '.jpg']),
    )
    expect(ACCEPT).not.toMatch(/heic/i)
  })
})

describe('pensionChoices', () => {
  it('names each pension the projection counts', () => {
    const view = retirementOf({
      pensions: [pension({}, { accountId: 'a' }), pension({}, { accountId: 'b', name: 'FERS' })],
    })
    expect(pensionChoices(view)).toEqual([
      { accountId: 'a', name: 'Colorado PERA' },
      { accountId: 'b', name: 'FERS' },
    ])
  })
})
