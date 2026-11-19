// Which paystub files Leeway reads, told apart by their first bytes rather
// than by the name or type the browser claims, and how large each may be.
// Pure, so the web app checks the same limits before it uploads.

import { AppError } from '../../errors.js'

/** The file types a paystub may come as, which Claude reads directly. */
export const PAYSTUB_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const

export type PaystubMediaType = (typeof PAYSTUB_TYPES)[number]

const MEGABYTE = 1024 * 1024

/**
 * The largest file of each type. A photo is capped at Anthropic's limit for
 * one image; a PDF paystub is a page or two, so 10 MB leaves plenty of room.
 */
export const MAX_PAYSTUB_BYTES: Record<PaystubMediaType, number> = {
  'application/pdf': 10 * MEGABYTE,
  'image/png': 5 * MEGABYTE,
  'image/jpeg': 5 * MEGABYTE,
}

/**
 * The most pages a PDF may have. A paystub is a page or two; Claude reads
 * every page sent, so a long statement would cost many times as much.
 */
export const MAX_PDF_PAGES = 5

/** The largest upload of any type, which the server refuses before reading further. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(MAX_PAYSTUB_BYTES))

/** A paystub file held in memory, checked and ready to read. */
export interface PaystubFile {
  bytes: Buffer
  mediaType: PaystubMediaType
}

/** Each type's signature: the bytes it starts with. */
const SIGNATURES: { mediaType: PaystubMediaType; starts: number[] }[] = [
  { mediaType: 'application/pdf', starts: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mediaType: 'image/png', starts: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mediaType: 'image/jpeg', starts: [0xff, 0xd8, 0xff] },
]

/** HEIC and HEIF photos carry "ftyp" and a brand like "heic" from byte 4. */
const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']

export const UNSUPPORTED =
  'Leeway reads a paystub as a PDF, PNG or JPEG. Save or export it as one of those and try again.'

/**
 * HEIC is what an iPhone camera saves, but Claude does not read it, and
 * converting it would need a large image library. Picking the photo in the
 * browser usually sends it as JPEG already; this says what to do when not.
 */
export const HEIC_HELP =
  'This photo is in HEIC, which Leeway cannot read yet. Take a screenshot of it, or set the iPhone camera to Most Compatible (Settings, Camera, Formats), and try again.'

function startsWith(bytes: Buffer, starts: number[]): boolean {
  return starts.every((byte, index) => bytes[index] === byte)
}

function isHeif(bytes: Buffer): boolean {
  return (
    bytes.subarray(4, 8).toString('latin1') === 'ftyp' &&
    HEIF_BRANDS.includes(bytes.subarray(8, 12).toString('latin1'))
  )
}

function megabytes(bytes: number): string {
  return `${bytes / MEGABYTE} MB`
}

/**
 * The file as a paystub Leeway can read, or a plain error saying why not:
 * empty, a type it does not read, or larger than that type allows.
 */
export function checkPaystubFile(bytes: Buffer): PaystubFile {
  if (bytes.length === 0) throw new AppError('invalid_input', 'The file is empty.')
  const known = SIGNATURES.find((signature) => startsWith(bytes, signature.starts))
  if (!known) throw new AppError('unsupported_file', isHeif(bytes) ? HEIC_HELP : UNSUPPORTED)
  const limit = MAX_PAYSTUB_BYTES[known.mediaType]
  if (bytes.length > limit) throw tooLarge(known.mediaType)
  return { bytes, mediaType: known.mediaType }
}

/** How a size message names each type. */
const WHAT_FILE: Record<PaystubMediaType, string> = {
  'application/pdf': 'A PDF',
  'image/png': 'A photo',
  'image/jpeg': 'A photo',
}

/** What to say of a file over its type's limit, or over every limit when the type is not known yet. */
export function tooLargeMessage(mediaType?: PaystubMediaType): string {
  const limit = mediaType ? MAX_PAYSTUB_BYTES[mediaType] : MAX_UPLOAD_BYTES
  const what = mediaType ? WHAT_FILE[mediaType] : 'A paystub'
  return `${what} can be up to ${megabytes(limit)}. Try a smaller file, such as one page of the paystub.`
}

/** The error for a file over its limit, as tooLargeMessage words it. */
export function tooLarge(mediaType?: PaystubMediaType): AppError {
  return new AppError('file_too_large', tooLargeMessage(mediaType))
}
