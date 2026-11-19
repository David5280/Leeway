// Counting a PDF's pages, so one too long to be a paystub is refused before
// Claude reads every page of it.

import { describe, expect, it } from 'vitest'
import { MAX_PDF_PAGES } from '../src/domain/paystubs/files.js'
import { checkPdfPages, pdfPageCount } from '../src/domain/paystubs/pdfPages.js'
import { packedPdfOfPages, pdf, pdfOfPages } from './fixtures/paystub.js'

describe('pdfPageCount', () => {
  it('counts the page objects, never the page tree above them', () => {
    expect(pdfPageCount(pdfOfPages(1))).toBe(1)
    expect(pdfPageCount(pdfOfPages(7))).toBe(7)
  })

  it('counts a page written again by a later edit of the file once', () => {
    expect(pdfPageCount(pdfOfPages(2, { rewritten: true }))).toBe(2)
  })

  it('reads past streams that hold no objects, such as a page drawing', () => {
    expect(pdfPageCount(pdfOfPages(3, { content: true }))).toBe(3)
  })

  it('counts pages packed into a compressed object stream', () => {
    expect(pdfPageCount(packedPdfOfPages(6))).toBe(6)
    // A length kept in another object leaves "endstream" to mark the end.
    expect(pdfPageCount(packedPdfOfPages(4, { length: 'reference' }))).toBe(4)
  })

  it('finds no pages where it cannot read them, and leaves the verdict to the reader', () => {
    expect(pdfPageCount(pdf())).toBe(0)
    expect(pdfPageCount(packedPdfOfPages(6, { filter: '/LZWDecode' }))).toBe(0)
    expect(pdfPageCount(packedPdfOfPages(6, { claimed: null }))).toBe(0)
    // A count beyond what the stream holds is not believed.
    expect(pdfPageCount(packedPdfOfPages(3, { claimed: 1_000_000_000 }))).toBe(3)
    // A stream that does not inflate is skipped, not a crash.
    const damaged = packedPdfOfPages(6)
    damaged.fill(0x41, damaged.indexOf('stream\n') + 7, damaged.indexOf('stream\n') + 20)
    expect(pdfPageCount(damaged)).toBe(0)
  })
})

describe('checkPdfPages', () => {
  it(`takes a PDF of up to ${MAX_PDF_PAGES} pages`, () => {
    expect(() => checkPdfPages(pdfOfPages(MAX_PDF_PAGES))).not.toThrow()
    expect(() => checkPdfPages(pdf())).not.toThrow()
  })

  it('refuses a longer one, saying how long it is', () => {
    expect(() => checkPdfPages(packedPdfOfPages(MAX_PDF_PAGES + 1))).toThrow(
      expect.objectContaining({
        code: 'file_too_large',
        message: `A PDF can be up to ${MAX_PDF_PAGES} pages, and this one has 6. Save just the page or two of the paystub as a PDF and try again.`,
      }),
    )
  })
})
