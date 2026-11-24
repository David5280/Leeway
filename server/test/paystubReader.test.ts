// The paystub reader around a document reader: it caches by file hash, caps
// paid reads an hour, refuses a file too long to be a paystub, and logs token
// counts and nothing else. The document reader is a fake (aiJobs.test.ts
// tests the real one), so no test calls the API.

import { describe, expect, it } from 'vitest'
import { ReaderError } from '../src/ai/documents.js'
import { AiLimitError } from '../src/domain/ai/limit.js'
import {
  CACHE_SIZE,
  CACHE_TTL_MS,
  fileHash,
  MAX_PAYSTUB_INPUT_TOKENS,
  PaystubReader,
  READS_PER_HOUR,
} from '../src/domain/paystubs/reader.js'
import { AppError } from '../src/errors.js'
import { HOUR_MS, MINUTE_MS } from '../src/lib/time.js'
import { CITY_READING, FakeReader, NOT_A_PAYSTUB, pdf, USAGE } from './fixtures/paystub.js'

/** A log that keeps every entry, to check what a read leaves in it. */
function memoryLog() {
  const entries: { fields: object; message: string }[] = []
  return { entries, info: (fields: object, message: string) => entries.push({ fields, message }) }
}

/** A reader around a fake document reader, on a clock the test moves. */
function readerWith(fake = new FakeReader()) {
  let now = Date.parse('2026-11-17T18:00:00Z')
  const reader = new PaystubReader(fake, () => now)
  return {
    reader,
    fake,
    log: memoryLog(),
    advance: (ms: number) => {
      now += ms
    },
  }
}

/** The AppError a read fails with. */
async function failure(read: Promise<unknown>): Promise<AppError> {
  const error: unknown = await read.catch((e) => e)
  expect(error).toBeInstanceOf(AppError)
  return error as AppError
}

/** A distinct PDF for each number, so each one is a new file to the cache. */
const nthFile = (n: number) => Buffer.concat([pdf(), Buffer.from(`page ${n}`)])

describe('PaystubReader', () => {
  it('reads a paystub for review, logging the token counts and nothing else', async () => {
    const { reader, fake, log } = readerWith()
    const read = await reader.read(pdf(), log)
    expect(read.readerName).toBe('Claude')
    expect(reader.readerName).toBe('Claude')
    expect(read.extraction.current.grossPay.cents).toBe(384_500)
    expect(fake.files).toEqual([{ bytes: pdf(), mediaType: 'application/pdf' }])
    expect(log.entries).toEqual([
      { fields: { reader: 'Claude', ...USAGE }, message: 'paystub read' },
    ])
    // The log never holds a figure, a line of the paystub or the file.
    expect(JSON.stringify(log.entries)).not.toMatch(/3,845|PERA|City of Example|PDF/)
  })

  it('names a file by its SHA-256, never by anything in it', () => {
    expect(fileHash(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('never sends the same file twice in a day, even two at once', async () => {
    const { reader, fake, log, advance } = readerWith()
    const [first, second] = await Promise.all([reader.read(pdf(), log), reader.read(pdf(), log)])
    expect(second).toEqual(first)
    await reader.read(pdf(), log)
    expect(fake.files).toHaveLength(1)
    // A day later the reading is forgotten, and the file is read again.
    advance(CACHE_TTL_MS)
    await reader.read(pdf(), log)
    expect(fake.files).toHaveLength(2)
  })

  it('keeps the readings used most recently, letting the oldest go', async () => {
    const { reader, fake, log, advance } = readerWith()
    /** Reads file n, waiting out the hourly cap whenever it is reached. */
    const read = async (n: number) => {
      if (fake.files.length % READS_PER_HOUR === 0) advance(HOUR_MS)
      await reader.read(nthFile(n), log)
    }
    for (let n = 0; n < CACHE_SIZE; n++) await read(n)
    // Using the first again makes it the newest, so the second goes when one more comes.
    await read(0)
    await read(CACHE_SIZE)
    expect(fake.files).toHaveLength(CACHE_SIZE + 1)
    await read(0)
    expect(fake.files).toHaveLength(CACHE_SIZE + 1)
    await read(1)
    expect(fake.files).toHaveLength(CACHE_SIZE + 2)
  }, 20_000)

  it('says plainly when the file is not a paystub, and does not pay to be told twice', async () => {
    const { reader, fake, log } = readerWith(new FakeReader(NOT_A_PAYSTUB))
    const error = await failure(reader.read(pdf(), log))
    expect(error.code).toBe('invalid_input')
    expect(error.message).toMatch(/^This does not look like a paystub/)
    await failure(reader.read(pdf(), log))
    expect(fake.files).toHaveLength(1)
    // A paystub with nothing readable on it is told the same.
    const empty = readerWith(new FakeReader({ ...NOT_A_PAYSTUB, isPaystub: true }))
    expect((await failure(empty.reader.read(pdf(), empty.log))).code).toBe('invalid_input')
  })

  it('refuses a file it does not read before anything is sent or counted', async () => {
    const { reader, fake, log } = readerWith()
    expect((await failure(reader.read(Buffer.from('hello'), log))).code).toBe('unsupported_file')
    expect(fake.files).toEqual([])
    expect(log.entries).toEqual([])
  })

  it('counts a file before reading it, and reads one a paystub could be', async () => {
    const { reader, fake, log } = readerWith()
    fake.tokens = MAX_PAYSTUB_INPUT_TOKENS
    await reader.read(pdf(), log)
    expect(fake.counted).toEqual([{ bytes: pdf(), mediaType: 'application/pdf' }])
    expect(fake.files).toEqual(fake.counted)
    // The read is handed the count, so the file is not counted twice.
    expect(fake.tokensGiven).toEqual([MAX_PAYSTUB_INPUT_TOKENS])
    // A kept reading needs no count.
    await reader.read(pdf(), log)
    expect(fake.counted).toHaveLength(1)
  })

  it('refuses a file too long to be a paystub, logging only its count, and never sends it', async () => {
    const { reader, fake, log } = readerWith()
    fake.tokens = MAX_PAYSTUB_INPUT_TOKENS + 1
    const refused = await failure(reader.read(pdf(), log))
    expect(refused).toMatchObject({
      code: 'file_too_large',
      message:
        'This file is too long to read as a paystub. Save just the page or two with your pay figures and try again.',
    })
    expect(fake.files).toEqual([])
    expect(log.entries).toEqual([
      {
        fields: { reader: 'Claude', inputTokens: MAX_PAYSTUB_INPUT_TOKENS + 1 },
        message: 'paystub too long',
      },
    ])
    // A count that is not a number is refused the same way.
    fake.tokens = Number.NaN
    expect((await failure(reader.read(pdf(), log))).code).toBe('file_too_large')
    expect(fake.files).toEqual([])
  })

  it('never sends a file it could not count, saying why in plain words', async () => {
    const { reader, fake, log } = readerWith()
    fake.tokens = new ReaderError('Claude is busy right now. Try again in a minute.')
    expect(await failure(reader.read(pdf(), log))).toMatchObject({
      code: 'reader_error',
      message: 'Claude is busy right now. Try again in a minute.',
    })
    // An unexpected failure is refused too, in words of Leeway's own.
    fake.tokens = new TypeError('bug')
    expect(await failure(reader.read(pdf(), log))).toMatchObject({
      code: 'reader_error',
      message:
        'Leeway could not check the length of this file, so it was not sent. Try again in a moment.',
    })
    expect(fake.counted).toHaveLength(2)
    expect(fake.files).toEqual([])
    expect(log.entries).toEqual([])
  })

  it('counts against the hourly cap, so counting cannot be used to call without limit', async () => {
    const { reader, fake, log } = readerWith()
    fake.tokens = MAX_PAYSTUB_INPUT_TOKENS + 1
    for (let n = 0; n < READS_PER_HOUR; n++) await failure(reader.read(nthFile(n), log))
    expect((await failure(reader.read(nthFile(READS_PER_HOUR), log))).code).toBe(
      'too_many_attempts',
    )
    expect(fake.counted).toHaveLength(READS_PER_HOUR)
  })

  it(`stops after ${READS_PER_HOUR} paid reads an hour, still giving readings it has`, async () => {
    const { reader, fake, log, advance } = readerWith()
    for (let n = 0; n < READS_PER_HOUR; n++) await reader.read(nthFile(n), log)
    const paused = await failure(reader.read(nthFile(READS_PER_HOUR), log))
    expect(paused.code).toBe('too_many_attempts')
    expect(paused.message).toBe(
      `Leeway has read ${READS_PER_HOUR} paystubs in the last hour. Try again in 60 minutes.`,
    )
    expect(fake.files).toHaveLength(READS_PER_HOUR)
    // A file already read costs nothing, so it is still given.
    expect((await reader.read(nthFile(0), log)).extraction.payDate).toBe('2026-11-13')
    advance(HOUR_MS - MINUTE_MS + 1)
    expect((await failure(reader.read(nthFile(READS_PER_HOUR), log))).message).toMatch(
      /Try again in 1 minute\.$/,
    )
    advance(MINUTE_MS)
    await reader.read(nthFile(READS_PER_HOUR), log)
    expect(fake.files).toHaveLength(READS_PER_HOUR + 1)
  })

  it("passes on a failed read in the reader's words, counts it, and tries again next time", async () => {
    const fake = new FakeReader(new ReaderError('Claude is busy right now. Try again in a minute.'))
    const { reader, log } = readerWith(fake)
    const error = await failure(reader.read(pdf(), log))
    expect(error).toMatchObject({
      code: 'reader_error',
      message: 'Claude is busy right now. Try again in a minute.',
    })
    // A failure is not kept, so the next try asks again.
    fake.answer = CITY_READING
    expect((await reader.read(pdf(), log)).extraction.payDate).toBe('2026-11-13')
    expect(fake.files).toHaveLength(2)
    expect(log.entries).toHaveLength(1)
  })

  it('says plainly when the monthly AI limit stops a read, and tries again next time', async () => {
    const limit = new AiLimitError("This month's AI limit of $5 is reached.", '2026-12-01')
    const fake = new FakeReader(limit)
    const { reader, log } = readerWith(fake)
    expect(await failure(reader.read(pdf(), log))).toMatchObject({
      code: 'ai_limit',
      status: 429,
      message: "This month's AI limit of $5 is reached.",
    })
    fake.answer = CITY_READING
    expect((await reader.read(pdf(), log)).extraction.payDate).toBe('2026-11-13')
  })

  it('lets an unexpected error through as it is', async () => {
    const { reader, log } = readerWith(new FakeReader(new TypeError('bug')))
    await expect(reader.read(pdf(), log)).rejects.toThrow(TypeError)
  })
})
