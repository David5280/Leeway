// Reads an uploaded paystub into figures for the owner to review, spending as
// little as it can: the same file is never sent twice, and the number of paid
// reads an hour is capped. The file lives in memory for the length of the
// request; only the figures the owner later confirms are saved, elsewhere.

import { createHash } from 'node:crypto'
import { ReaderError, type DocumentReader } from '../../ai/documents.js'
import { AppError } from '../../errors.js'
import { AttemptLimiter } from '../../lib/attemptLimiter.js'
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../lib/time.js'
import { checkPaystubFile, type PaystubFile } from './files.js'
import { extractionFrom, foundAnything, type PaystubExtraction } from './reading.js'

/** Paid reads allowed an hour: plenty for a few paystubs and a retry or two. */
export const READS_PER_HOUR = 10

/** Readings kept, newest first used, so a file sent again costs nothing. */
export const CACHE_SIZE = 50

/** How long a reading is kept: long enough to come back to it, short enough to forget. */
export const CACHE_TTL_MS = DAY_MS

const NOT_A_PAYSTUB =
  'This does not look like a paystub, or Leeway could not find any figures on it. Try a clearer photo or the PDF itself.'

/** Where token counts go: a pino logger, as Fastify gives each request. */
export interface UsageLog {
  info(fields: object, message: string): void
}

/** A reading for review, with who read it. */
export interface PaystubRead {
  extraction: PaystubExtraction
  readerName: string
}

/** A finished reading: the figures, or null when the file held no paystub. */
type Outcome = PaystubExtraction | null

/** The SHA-256 of a file, which names it in the cache without keeping any of it. */
export function fileHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export class PaystubReader {
  /** Finished readings by file hash; a Map keeps insertion order, oldest first. */
  private readonly cache = new Map<string, { outcome: Outcome; expiresAt: number }>()
  /** Reads under way, so the same file sent twice at once is read once. */
  private readonly pending = new Map<string, Promise<Outcome>>()
  private readonly limiter: AttemptLimiter

  constructor(
    private readonly reader: DocumentReader,
    private readonly now: () => number = Date.now,
  ) {
    // One owner per install, so one limiter is the owner's limit.
    this.limiter = new AttemptLimiter({ maxAttempts: READS_PER_HOUR, windowMs: HOUR_MS, now })
  }

  /** Who reads the paystubs, like "Claude". */
  get readerName(): string {
    return this.reader.name
  }

  /**
   * The figures on a paystub, or a plain error: a file Leeway does not read,
   * too many reads this hour, a failed read, or no paystub found.
   */
  async read(bytes: Buffer, log: UsageLog): Promise<PaystubRead> {
    const file = checkPaystubFile(bytes)
    const hash = fileHash(bytes)
    // A kept "not a paystub" is null, so only undefined means nothing is kept.
    const kept = this.cached(hash)
    const outcome = kept === undefined ? await this.readOnce(hash, () => this.ask(file, log)) : kept
    if (outcome === null) throw new AppError('invalid_input', NOT_A_PAYSTUB)
    return { extraction: outcome, readerName: this.reader.name }
  }

  /** A kept reading of this file, refreshed as the newest; undefined when none. */
  private cached(hash: string): Outcome | undefined {
    const entry = this.cache.get(hash)
    if (!entry) return undefined
    this.cache.delete(hash)
    if (entry.expiresAt <= this.now()) return undefined
    this.cache.set(hash, entry)
    return entry.outcome
  }

  /** Reads a file once however many requests ask for it at the same time, and keeps the result. */
  private async readOnce(hash: string, read: () => Promise<Outcome>): Promise<Outcome> {
    const underway = this.pending.get(hash)
    if (underway) return underway
    const reading = read()
    this.pending.set(hash, reading)
    try {
      const outcome = await reading
      this.keep(hash, outcome)
      return outcome
    } finally {
      this.pending.delete(hash)
    }
  }

  private keep(hash: string, outcome: Outcome): void {
    this.cache.set(hash, { outcome, expiresAt: this.now() + CACHE_TTL_MS })
    // Past the limit, the reading used longest ago goes first.
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!)
  }

  /** One paid read: counted against the hourly cap, with its token counts logged and nothing else. */
  private async ask(file: PaystubFile, log: UsageLog): Promise<Outcome> {
    this.checkNotPaused()
    this.limiter.record()
    try {
      const { reading, usage } = await this.reader.readPaystub(file)
      log.info({ reader: this.reader.name, ...usage }, 'paystub read')
      const extraction = extractionFrom(reading)
      return reading.isPaystub && foundAnything(extraction) ? extraction : null
    } catch (error) {
      if (error instanceof ReaderError) throw new AppError('reader_error', error.message)
      throw error
    }
  }

  private checkNotPaused(): void {
    const waitMs = this.limiter.waitMs()
    if (waitMs === 0) return
    const minutes = Math.ceil(waitMs / MINUTE_MS)
    const unit = minutes === 1 ? 'minute' : 'minutes'
    throw new AppError(
      'too_many_attempts',
      `Leeway has read ${READS_PER_HOUR} paystubs in the last hour. Try again in ${minutes} ${unit}.`,
    )
  }
}
