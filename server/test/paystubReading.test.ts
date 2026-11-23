// The pure parts of paystub import: which files are read, how identifiers are
// taken out of what the reader saw, and how its amounts become the cents the
// owner reviews.

import { describe, expect, it } from 'vitest'
import { AppError } from '../src/errors.js'
import {
  checkPaystubFile,
  MAX_PAYSTUB_BYTES,
  MAX_UPLOAD_BYTES,
  tooLarge,
} from '../src/domain/paystubs/files.js'
import {
  MAX_EMPLOYER_LENGTH,
  MAX_SOURCE_LENGTH,
  redact,
  redactEmployer,
  redactSource,
  REMOVED,
} from '../src/domain/paystubs/redact.js'
import { hoursOf, rateCentsOf } from '../src/domain/paystubs/amounts.js'
import { centsOf } from '../src/domain/paystubs/reading.js'
import { heic, jpeg, pdf, png } from './fixtures/paystub.js'

/** The AppError a check throws, so a test can read its code and message. */
function failure(check: () => unknown): AppError {
  try {
    check()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error('The check passed')
}

describe('checkPaystubFile', () => {
  it('tells a PDF, PNG and JPEG apart by their first bytes', () => {
    expect(checkPaystubFile(pdf()).mediaType).toBe('application/pdf')
    expect(checkPaystubFile(png()).mediaType).toBe('image/png')
    expect(checkPaystubFile(jpeg()).mediaType).toBe('image/jpeg')
    // The bytes go on as they came, never copied to disk or elsewhere.
    const file = pdf()
    expect(checkPaystubFile(file).bytes).toBe(file)
  })

  it('refuses an empty file and any other type, whatever it is called', () => {
    expect(failure(() => checkPaystubFile(Buffer.alloc(0)))).toMatchObject({
      code: 'invalid_input',
      message: 'The file is empty.',
    })
    const text = failure(() => checkPaystubFile(Buffer.from('Gross Pay 3,845.00')))
    expect(text.code).toBe('unsupported_file')
    expect(text.message).toMatch(/^Leeway reads a paystub as a PDF, PNG or JPEG\./)
    // A PDF signature anywhere but the start is not a PDF.
    expect(failure(() => checkPaystubFile(Buffer.from(' %PDF-1.7'))).code).toBe('unsupported_file')
  })

  it('says what to do with an iPhone HEIC photo', () => {
    const error = failure(() => checkPaystubFile(heic()))
    expect(error.code).toBe('unsupported_file')
    expect(error.message).toContain('This photo is in HEIC')
    expect(error.message).toContain('Most Compatible')
    // Another ftyp file, such as a video, gets the plain message.
    const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), pdf()])
    expect(failure(() => checkPaystubFile(video)).message).toMatch(/^Leeway reads a paystub/)
  })

  it('holds each type to its own size, up to the limit and not past it', () => {
    const photoLimit = MAX_PAYSTUB_BYTES['image/png']
    expect(checkPaystubFile(png(photoLimit)).bytes).toHaveLength(photoLimit)
    expect(failure(() => checkPaystubFile(jpeg(photoLimit + 1)))).toMatchObject({
      code: 'file_too_large',
      message: 'A photo can be up to 5 MB. Try a smaller file, such as one page of the paystub.',
    })
    const pdfLimit = MAX_PAYSTUB_BYTES['application/pdf']
    expect(checkPaystubFile(pdf(pdfLimit)).bytes).toHaveLength(pdfLimit)
    expect(failure(() => checkPaystubFile(pdf(pdfLimit + 1))).message).toMatch(
      /^A PDF can be up to 10 MB\./,
    )
    expect(MAX_UPLOAD_BYTES).toBe(pdfLimit)
    expect(tooLarge().message).toMatch(/^A paystub can be up to 10 MB\./)
  })
})

describe('redact', () => {
  it('takes out a Social Security number, plain, spaced or masked', () => {
    for (const ssn of ['123-45-6789', '123 45 6789', 'XXX-XX-6789', '***-**-6789']) {
      expect(redact(`Gross Pay 3,845.00 ${ssn}`)).toBe(`Gross Pay 3,845.00 ${REMOVED}`)
    }
  })

  it('takes out a labeled identifier and the rest of its line', () => {
    expect(redact('Employee ID 004417')).toBe(REMOVED)
    expect(redact('Net Pay 2,611.42 Deposit to acct 000123456789')).toBe(
      `Net Pay 2,611.42 Deposit to ${REMOVED}`,
    )
    expect(redact('Routing 102000021')).toBe(REMOVED)
    expect(redact('Emp # A-77\nPERA 422.95')).toBe(`${REMOVED} PERA 422.95`)
  })

  it('takes out an address, a post office box and an email', () => {
    expect(redact('Pay to 1437 Bannock St Apt 4 Denver CO 80202')).toBe(
      `Pay to ${REMOVED} Denver ${REMOVED}`,
    )
    expect(redact('PO Box 1234')).toBe(REMOVED)
    expect(redact('Questions: payroll@example.gov')).toBe(`Questions: ${REMOVED}`)
  })

  it('takes out any other long number, keeping money, dates and percents', () => {
    expect(redact('Check 0045521 PERA 11.00% 1,234.56 on 11/13/2026 (12.50)')).toBe(
      `Check ${REMOVED} PERA 11.00% 1,234.56 on 11/13/2026 (12.50)`,
    )
    expect(redact('Period 2026-10-26 hours 80.00 rate 48.0625')).toBe(
      `Period 2026-10-26 hours 80.00 rate ${REMOVED}`,
    )
  })

  it("takes out a person's name after a label or a title, but not a plan's name", () => {
    expect(redact('Employee Name Jane Doe')).toBe(REMOVED)
    expect(redact('Name: Jane Q. Doe')).toBe(REMOVED)
    expect(redact('Net 2,611.42 Pay to the order of Jane Doe')).toBe(`Net 2,611.42 ${REMOVED}`)
    expect(redact('Payee John Roe 100.00')).toBe(REMOVED)
    expect(redact('Prepared for Ms. Jane Doe 3,845.00')).toBe(`Prepared for ${REMOVED} 3,845.00`)
    expect(redact('Plan Name: PERA 422.95')).toBe('Plan Name: PERA 422.95')
    expect(redact('Employee 401k 150.00')).toBe('Employee 401k 150.00')
  })

  it('takes out a masked account or card number, which keeps too few digits to look long', () => {
    for (const masked of ['XXXXXX1234', '****1234', 'xx-1234', '••••5678']) {
      expect(redact(`Direct deposit ${masked} 2,611.42`)).toBe(`Direct deposit ${REMOVED} 2,611.42`)
    }
    // A short amount or a plan number stays.
    expect(redact('Roth 457 50.00')).toBe('Roth 457 50.00')
  })

  it('reads several removals in a row as one', () => {
    expect(redact('SSN 123-45-6789')).toBe(REMOVED)
    expect(redact('5551234567 5559876543 Net 10.00')).toBe(`${REMOVED} Net 10.00`)
  })
})

describe('redactSource and redactEmployer', () => {
  it('keeps a source line short, and drops one with nothing left', () => {
    expect(redactSource(null)).toBeNull()
    expect(redactSource('SSN 123-45-6789')).toBeNull()
    expect(redactSource('   ')).toBeNull()
    expect(redactSource(`Gross Pay ${'x'.repeat(200)}`)).toHaveLength(MAX_SOURCE_LENGTH)
  })

  it('drops a line that names a garnishment, levy or support order whole', () => {
    for (const line of [
      'Garnishment 150.00',
      'Wage Garnish Case 4471 150.00',
      'Child Support 200.00',
      'IRS Levy 75.00',
      'Ch 13 Bankruptcy Trustee 90.00',
    ]) {
      expect(redactSource(line)).toBeNull()
    }
    expect(redactSource('Union Dues 25.00')).toBe('Union Dues 25.00')
  })

  it('keeps only the employer name, never the address after it', () => {
    expect(redactEmployer(null)).toBeNull()
    expect(redactEmployer('City of Example, 1437 Bannock St, Denver CO 80202')).toBe(
      'City of Example',
    )
    expect(redactEmployer('City of Example 1437 Bannock St')).toBe('City of Example')
    // The city and state after a street address on the same line go with it.
    expect(redactEmployer('City of Example 1437 Bannock St Denver CO 80202')).toBe(
      'City of Example',
    )
    expect(redactEmployer('Acme Corp PO Box 12 Aurora CO 80012')).toBe('Acme Corp')
    // A line that starts with something taken out keeps the name after it.
    expect(redactEmployer('80202-1234 City of Example')).toBe('City of Example')
    expect(redactEmployer('Acme\nPO Box 12')).toBe('Acme')
    expect(redactEmployer('123-45-6789')).toBeNull()
    expect(redactEmployer('A'.repeat(200))).toHaveLength(MAX_EMPLOYER_LENGTH)
  })
})

describe('centsOf', () => {
  it('reads an amount as printed, in cents', () => {
    expect(centsOf('1,234.56')).toBe(123_456)
    expect(centsOf('$275')).toBe(27_500)
    expect(centsOf('$ 275.5')).toBe(27_550)
    expect(centsOf('0.07')).toBe(7)
  })

  it('reads a deduction printed in parentheses or with a minus as positive', () => {
    expect(centsOf('(422.95)')).toBe(42_295)
    expect(centsOf('-422.95')).toBe(42_295)
  })

  it('adds two lines of the same kind joined with a plus', () => {
    expect(centsOf('150.00 + 50.00')).toBe(20_000)
    expect(centsOf('150.00 + (50.00)')).toBe(20_000)
  })

  it('reads nothing that is not an amount, rather than guess', () => {
    for (const printed of ['', 'about 400', '1,23.00', '12.345', '1.2.3', '150 + n/a', '+']) {
      expect(centsOf(printed)).toBeNull()
    }
  })
})

describe('rateCentsOf and hoursOf', () => {
  it('reads a rate printed to four places, rounded to the cent', () => {
    expect(rateCentsOf('31.2500')).toBe(3_125)
    expect(rateCentsOf('$28.3750')).toBe(2_838)
    expect(rateCentsOf('28.37501')).toBeNull()
  })

  it('reads hours to the hundredth, adding regular and overtime hours', () => {
    expect(hoursOf('80.00')).toBe(80)
    expect(hoursOf('86.6667')).toBe(86.67)
    expect(hoursOf('80 + 4.5')).toBe(84.5)
    expect(hoursOf('eighty')).toBeNull()
  })
})
