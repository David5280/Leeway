// Counts the pages of a PDF without a PDF library, so a long document is
// refused before it is sent: Claude reads every page, and a hundred-page
// statement costs a hundred times a paystub. Pure, apart from Node's zlib.
//
// A page is an object whose dictionary says /Type /Page. Most PDFs write
// objects in plain sight ("12 0 obj << ... >> endobj"); newer ones may pack
// them into compressed object streams (/Type /ObjStm), which are inflated
// here and read the same way. Pages are counted by object number, so a page
// written again by a later edit of the file counts once.

import { inflateSync } from 'node:zlib'
import { AppError } from '../../errors.js'
import { MAX_PDF_PAGES } from './files.js'

/** A page's dictionary entry. "/Type /Pages" is the tree above the pages, so it is left out. */
const PAGE_TYPE = /\/Type\s*\/Page(?![A-Za-z])/

/** An object in plain sight: its number, then its body up to "endobj". */
const PLAIN_OBJECT = /(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g

/** An object's dictionary up to its stream, where an object stream's own entries are. */
const STREAM_START = /(\d+)\s+\d+\s+obj\b([\s\S]*?)\bstream\r?\n/g

/** A whole-number entry written directly, as in "/N 12"; not a reference like "/Length 9 0 R". */
function entry(dictionary: string, name: string): number | null {
  const found = new RegExp(`/${name}\\s+(\\d+)(?!\\s+\\d+\\s+R)`).exec(dictionary)
  return found ? Number(found[1]) : null
}

/** The objects in one compressed object stream, by number, or none when it cannot be read. */
function packedObjects(pdf: Buffer, dictionary: string, start: number): [number, string][] {
  const count = entry(dictionary, 'N')
  const first = entry(dictionary, 'First')
  // Only Flate is used for object streams in practice; anything else is skipped.
  if (count === null || first === null || !/\/FlateDecode\b/.test(dictionary)) return []
  const length = entry(dictionary, 'Length')
  const end = length === null ? pdf.indexOf('endstream', start, 'latin1') : start + length
  let text: string
  try {
    text = inflateSync(pdf.subarray(start, end)).toString('latin1')
  } catch {
    return []
  }
  // The stream opens with pairs of "object number, offset after /First".
  const header = text.slice(0, first).trim().split(/\s+/).map(Number)
  // A count larger than the header holds is not believed, so it cannot run away.
  const objects = Math.min(count, Math.floor(header.length / 2))
  return Array.from({ length: objects }, (_, index): [number, string] => {
    const from = first + header[index * 2 + 1]!
    const to = index + 1 < objects ? first + header[index * 2 + 3]! : text.length
    return [header[index * 2]!, text.slice(from, to)]
  })
}

/**
 * How many pages a PDF has, by its page objects. Zero when none can be found,
 * as in a file too damaged to read, which Claude then refuses on its own.
 */
export function pdfPageCount(pdf: Buffer): number {
  const text = pdf.toString('latin1')
  const pages = new Set<number>()
  for (const [, number, body] of text.matchAll(PLAIN_OBJECT)) {
    if (PAGE_TYPE.test(body!)) pages.add(Number(number))
  }
  for (const found of text.matchAll(STREAM_START)) {
    const dictionary = found[2]!
    if (!/\/Type\s*\/ObjStm\b/.test(dictionary)) continue
    const start = found.index + found[0].length
    for (const [number, body] of packedObjects(pdf, dictionary, start)) {
      if (PAGE_TYPE.test(body)) pages.add(number)
    }
  }
  return pages.size
}

/** Refuses a PDF longer than a paystub could be, saying how many pages it has. */
export function checkPdfPages(pdf: Buffer): void {
  const pages = pdfPageCount(pdf)
  if (pages > MAX_PDF_PAGES) {
    throw new AppError(
      'file_too_large',
      `A PDF can be up to ${MAX_PDF_PAGES} pages, and this one has ${pages}. Save just the page or two of the paystub as a PDF and try again.`,
    )
  }
}
