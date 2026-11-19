// Reading a paystub: the one request sent to Claude and its free token count,
// through a fake client so no test calls the API, and the reader around it
// that caches by file hash, caps paid reads an hour, refuses a file too long
// to be a paystub and logs token counts and nothing else.

import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { MessagesClient } from '../src/ai/anthropic.js'
import {
  AnthropicDocumentReader,
  PAYSTUB_PROMPT,
  readerErrorFrom,
} from '../src/ai/anthropicDocuments.js'
import { ReaderError } from '../src/ai/documents.js'
import type { AnthropicConfig } from '../src/config.js'
import { checkPaystubFile } from '../src/domain/paystubs/files.js'
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
import {
  CITY_READING,
  FakeReader,
  jpeg,
  NOT_A_PAYSTUB,
  PAGE_TOKENS,
  pdf,
  png,
  USAGE,
} from './fixtures/paystub.js'

const CONFIG: AnthropicConfig = {
  apiKey: 'test-key',
  model: 'claude-haiku-5-5',
  paystubModel: 'claude-haiku-5-5',
}

/** What Claude's parse() answers: a stop reason, the parsed output and the tokens used. */
interface FakeResponse {
  stop_reason: string
  parsed_output: unknown
  usage: { input_tokens: number; output_tokens: number }
}

const ANSWER: FakeResponse = {
  stop_reason: 'end_turn',
  parsed_output: CITY_READING,
  usage: { input_tokens: 1_850, output_tokens: 640 },
}

/**
 * A reader on a client that answers every request with the response, or
 * throws the error, and records each request; a count answers with the
 * tokens, or throws the count's error, and is recorded apart.
 */
function fakeClient(
  answer: FakeResponse | Error = ANSWER,
  config = CONFIG,
  count: number | Error = PAGE_TOKENS,
) {
  const requests: Record<string, unknown>[] = []
  const counts: Record<string, unknown>[] = []
  const client = {
    messages: {
      parse: (request: Record<string, unknown>) => {
        requests.push(request)
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
      },
      countTokens: (request: Record<string, unknown>) => {
        counts.push(request)
        return count instanceof Error
          ? Promise.reject(count)
          : Promise.resolve({ input_tokens: count })
      },
    },
  } as unknown as MessagesClient
  return { reader: new AnthropicDocumentReader(config, client), requests, counts }
}

/** The ReaderError a read fails with. */
async function readFailure(reader: AnthropicDocumentReader): Promise<ReaderError> {
  const error: unknown = await reader.readPaystub(checkPaystubFile(pdf())).catch((e) => e)
  expect(error).toBeInstanceOf(ReaderError)
  return error as ReaderError
}

describe('AnthropicDocumentReader', () => {
  it('sends one request: the paystub model, the prompt, the file and a fixed ask, nothing more', async () => {
    const { reader, requests } = fakeClient()
    const file = checkPaystubFile(pdf())
    const read = await reader.readPaystub(file)
    expect(read).toEqual({
      reading: CITY_READING,
      usage: { model: 'claude-haiku-5-5', inputTokens: 1_850, outputTokens: 640 },
    })
    expect(reader.name).toBe('Claude')
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    // Every key the request carries: nothing else of the owner's goes with the file.
    expect(Object.keys(request).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'output_config',
      'system',
    ])
    expect(request).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 3000,
      system: PAYSTUB_PROMPT,
      output_config: { effort: 'low', format: expect.anything() },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: file.bytes.toString('base64'),
              },
            },
            { type: 'text', text: 'Read this paystub.' },
          ],
        },
      ],
    })
  })

  it('sends a photo as an image, and uses the model the owner picked', async () => {
    const { reader, requests } = fakeClient(ANSWER, {
      ...CONFIG,
      paystubModel: 'claude-sonnet-5-5',
    })
    for (const bytes of [png(), jpeg()]) {
      const file = checkPaystubFile(bytes)
      const { usage } = await reader.readPaystub(file)
      expect(usage.model).toBe('claude-sonnet-5-5')
      const [block] = (requests.at(-1)!.messages as { content: unknown[] }[])[0]!.content
      expect(block).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: file.mediaType, data: file.bytes.toString('base64') },
      })
    }
    expect(requests.every((request) => request.model === 'claude-sonnet-5-5')).toBe(true)
  })

  it('asks the model never to copy an identifier, and never to do arithmetic', () => {
    expect(PAYSTUB_PROMPT).toContain('Never copy a Social Security number')
    expect(PAYSTUB_PROMPT).toContain('Never add, subtract or estimate')
    expect(PAYSTUB_PROMPT).not.toMatch(/\d+(\.\d+)?%/)
  })

  it('refuses a declined, cut-off or misshapen reading', async () => {
    const declined = fakeClient({ ...ANSWER, stop_reason: 'refusal', parsed_output: null })
    expect((await readFailure(declined.reader)).message).toBe('Claude declined to read this file.')
    const cut = fakeClient({ ...ANSWER, stop_reason: 'max_tokens', parsed_output: null })
    expect((await readFailure(cut.reader)).message).toMatch(/^The reading was cut off\./)
    const misshapen = fakeClient({ ...ANSWER, parsed_output: { isPaystub: 'yes' } })
    expect((await readFailure(misshapen.reader)).message).toBe(
      'The reading came back in an unexpected shape.',
    )
  })

  it("turns the SDK's errors into messages the owner can act on, never the SDK's own words", async () => {
    const secret = 'request quoted: Gross Pay 3,845.00'
    const headers = new Headers()
    const cases: [unknown, RegExp][] = [
      [new Anthropic.AuthenticationError(401, {}, secret, headers), /API key was not accepted/],
      [new Anthropic.PermissionDeniedError(403, {}, secret, headers), /API key was not accepted/],
      [new Anthropic.RateLimitError(429, {}, secret, headers), /^Claude is busy right now/],
      [new Anthropic.ContentTooLargeError(413, {}, secret, headers), /too large for Claude/],
      [new Anthropic.BadRequestError(400, {}, secret, headers), /could not open this file/],
      [new Anthropic.APIConnectionError({ message: secret }), /could not reach Claude/],
      [new Anthropic.InternalServerError(500, {}, secret, headers), /had a problem reading/],
      [new Error(secret), /^The paystub could not be read/],
    ]
    for (const [error, message] of cases) {
      const mapped = readerErrorFrom(error)
      expect(mapped).toBeInstanceOf(ReaderError)
      expect(mapped.message).toMatch(message)
      expect(mapped.message).not.toContain('3,845')
    }
    const failing = fakeClient(new Anthropic.RateLimitError(429, {}, secret, headers))
    expect((await readFailure(failing.reader)).message).toMatch(/^Claude is busy/)
  })

  it('counts the tokens of exactly the request a read sends, without max_tokens', async () => {
    const { reader, requests, counts } = fakeClient()
    for (const bytes of [pdf(), png()]) {
      const file = checkPaystubFile(bytes)
      expect(await reader.countPaystubTokens(file)).toBe(PAGE_TOKENS)
      await reader.readPaystub(file)
    }
    expect(counts).toHaveLength(2)
    counts.forEach((count, n) => {
      // The same model, prompt, file, effort and schema: only the cap on the answer is left out.
      const { max_tokens, ...read } = requests[n]!
      expect(max_tokens).toBe(3000)
      // As JSON, since each request builds its own schema parser.
      expect(JSON.stringify(count)).toBe(JSON.stringify(read))
      expect(Object.keys(count).sort()).toEqual(['messages', 'model', 'output_config', 'system'])
    })
  })

  it("fails a count in the owner's words, never the SDK's", async () => {
    const secret = 'request quoted: Gross Pay 3,845.00'
    const error = new Anthropic.APIConnectionError({ message: secret })
    const { reader } = fakeClient(ANSWER, CONFIG, error)
    const failed: unknown = await reader.countPaystubTokens(checkPaystubFile(pdf())).catch((e) => e)
    expect(failed).toBeInstanceOf(ReaderError)
    expect((failed as ReaderError).message).toBe(
      'Leeway could not reach Claude. Try again in a moment.',
    )
  })

  it('builds its own client from the key when given none, without calling it', () => {
    expect(new AnthropicDocumentReader(CONFIG).name).toBe('Claude')
  })
})

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

  it('lets an unexpected error through as it is', async () => {
    const { reader, log } = readerWith(new FakeReader(new TypeError('bug')))
    await expect(reader.read(pdf(), log)).rejects.toThrow(TypeError)
  })
})
