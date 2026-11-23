// The two AI jobs on the usage layer: the dashboard summary and the paystub
// reader. Each asks through a fake provider, so no test calls a model.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ReaderError } from '../src/ai/documents.js'
import {
  AiDocumentReader,
  PAYSTUB_MAX_TOKENS,
  PAYSTUB_PROMPT,
  readerErrorFrom,
} from '../src/ai/paystubs.js'
import { AiProviderError, type AiFailure } from '../src/ai/provider.js'
import { aiServices } from '../src/ai/services.js'
import { AiSummaryWriter, SUMMARY_MAX_TOKENS, SYSTEM_PROMPT } from '../src/ai/summary.js'
import { AiLimitError } from '../src/domain/ai/gateway.js'
import { checkPaystubFile } from '../src/domain/paystubs/files.js'
import { PaystubReader } from '../src/domain/paystubs/reader.js'
import { getSettings, saveSettings } from '../src/domain/settings.js'
import type { SummaryFacts } from '../src/domain/summaryFacts.js'
import { createTestContext, resetData } from './helpers.js'
import { FakeProvider, gatewayFor, NO_OVERRIDES, tokens } from './fixtures/ai.js'
import { CITY_READING, jpeg, pdf } from './fixtures/paystub.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

const facts = {
  today: 'Nov 17',
  period: { kind: 'month', left: '$1,200' },
} as unknown as SummaryFacts

/** A writer whose provider answers with the given output, or stops for the given reason. */
function writerWith(output: unknown, stop: 'done' | 'refused' | 'cut_off' = 'done') {
  const provider = new FakeProvider()
  provider.reply = { stop, output, usage: tokens() }
  const { ai } = gatewayFor(ctx, provider)
  return { writer: new AiSummaryWriter(ai), provider }
}

describe('AiSummaryWriter', () => {
  it('asks the summary model, at low effort, for a headline and points from the facts', async () => {
    const { writer, provider } = writerWith({
      headline: '  You are on track.  ',
      points: ['Payday is Dec 1.'],
    })
    expect(await writer.write(facts)).toEqual({
      headline: 'You are on track.',
      points: ['Payday is Dec 1.'],
    })
    expect(writer.name).toBe('Claude')
    const request = provider.sent[0]!
    expect(request).toMatchObject({
      model: 'claude-haiku-5-5',
      system: SYSTEM_PROMPT,
      effort: 'low',
      maxTokens: SUMMARY_MAX_TOKENS,
    })
    expect(JSON.stringify(request.content)).toContain('$1,200')
    // The call is recorded against the summary.
    const { rows } = await ctx.db.query('SELECT job FROM ai_usage')
    expect(rows).toEqual([{ job: 'summary' }])
  })

  it('keeps an urgent account alert as the headline, whatever the model wrote', async () => {
    const { writer } = writerWith({ headline: 'You are on track.', points: ['Payday is Dec 1.'] })
    const overdrawn = 'Your Chase checking account is overdrawn by $42.10.'
    const summary = await writer.write({ ...facts, fixedHeadline: overdrawn })
    expect(summary).toEqual({ headline: overdrawn, points: ['Payday is Dec 1.'] })
    expect(SYSTEM_PROMPT).toContain('fixedHeadline')
  })

  it('tells the model never to say the person saves too little', () => {
    // The bank never sees payroll saving, and a pension is saving in itself, so any such claim could be wrong.
    expect(SYSTEM_PROMPT).toContain('a pension counts only once the person enters it')
    expect(SYSTEM_PROMPT).toContain('a 401(k) only once they save a recent paystub that shows it')
    expect(SYSTEM_PROMPT).toContain('a pension is retirement saving in itself')
    expect(SYSTEM_PROMPT).toContain(
      'Never say or imply that the person saves too little or should save more',
    )
  })

  it('throws when the model declines, is cut off, or answers in the wrong shape', async () => {
    await expect(writerWith(null, 'refused').writer.write(facts)).rejects.toThrow('declined')
    await expect(writerWith(null, 'cut_off').writer.write(facts)).rejects.toThrow('cut off')
    const tooMany = writerWith({ headline: 'Fine.', points: ['a', 'b', 'c', 'd', 'e'] })
    await expect(tooMany.writer.write(facts)).rejects.toThrow('unexpected shape')
    const empty = writerWith({ headline: ' ', points: ['a'] })
    await expect(empty.writer.write(facts)).rejects.toThrow('unexpected shape')
  })

  it('throws the limit as it is, so the dashboard can say why', async () => {
    const { writer, provider } = writerWith({ headline: 'Fine.', points: ['a'] })
    const settings = await getSettings(ctx.db)
    await saveSettings(ctx.db, { ...settings, ai: { ...settings.ai, monthlyCapCents: 0 } })
    await expect(writer.write(facts)).rejects.toThrow(AiLimitError)
    expect(provider.sent).toEqual([])
  })
})

/** A document reader whose provider answers with a reading, or fails. */
function documentReaderWith(
  output: unknown = CITY_READING,
  stop: 'done' | 'refused' | 'cut_off' = 'done',
) {
  const provider = new FakeProvider()
  provider.reply = { stop, output, usage: tokens({ inputTokens: 1_850, outputTokens: 640 }) }
  const { ai } = gatewayFor(ctx, provider)
  return { reader: new AiDocumentReader(ai), provider }
}

/** The ReaderError a read fails with. */
async function readFailure(reader: AiDocumentReader): Promise<ReaderError> {
  const error: unknown = await reader.readPaystub(checkPaystubFile(pdf()), 5_000).catch((e) => e)
  expect(error).toBeInstanceOf(ReaderError)
  return error as ReaderError
}

describe('AiDocumentReader', () => {
  it('sends one request: the prompt, the file and a fixed ask, nothing more', async () => {
    const { reader, provider } = documentReaderWith()
    const file = checkPaystubFile(pdf())
    expect(await reader.readPaystub(file, 5_000)).toEqual({
      reading: CITY_READING,
      usage: { model: 'claude-haiku-5-5', inputTokens: 1_850, outputTokens: 640 },
    })
    expect(reader.name).toBe('Claude')
    expect(provider.sent).toEqual([
      {
        model: 'claude-haiku-5-5',
        system: PAYSTUB_PROMPT,
        content: [
          { type: 'file', mediaType: 'application/pdf', data: file.bytes },
          { type: 'text', text: 'Read this paystub.' },
        ],
        format: expect.anything(),
        effort: 'low',
        maxTokens: PAYSTUB_MAX_TOKENS,
      },
    ])
    // The count the reader was given is used, not made again.
    expect(provider.counted).toEqual([])
    const { rows } = await ctx.db.query('SELECT job, input_tokens FROM ai_usage')
    expect(rows).toEqual([{ job: 'paystub', input_tokens: 1_850 }])
  })

  it('counts the very ask a read sends, with the model the owner picked', async () => {
    const { reader, provider } = documentReaderWith()
    const settings = await getSettings(ctx.db)
    await saveSettings(ctx.db, {
      ...settings,
      ai: { ...settings.ai, models: { summary: null, paystub: 'claude-sonnet-5-5' } },
    })
    const file = checkPaystubFile(jpeg())
    expect(await reader.countPaystubTokens(file)).toBe(2_000)
    const { usage } = await reader.readPaystub(file, 2_000)
    expect(usage.model).toBe('claude-sonnet-5-5')
    expect(provider.counted).toEqual(provider.sent)
  })

  it('asks the model never to copy an identifier, and never to do arithmetic', () => {
    expect(PAYSTUB_PROMPT).toContain('Never copy a Social Security number')
    expect(PAYSTUB_PROMPT).toContain('Never add, subtract or estimate')
    expect(PAYSTUB_PROMPT).not.toMatch(/\d+(\.\d+)?%/)
  })

  it('refuses a declined, cut-off or misshapen reading', async () => {
    expect((await readFailure(documentReaderWith(null, 'refused').reader)).message).toBe(
      'Claude declined to read this file.',
    )
    expect((await readFailure(documentReaderWith(null, 'cut_off').reader)).message).toMatch(
      /^The reading was cut off\./,
    )
    expect((await readFailure(documentReaderWith({ isPaystub: 'yes' }).reader)).message).toBe(
      'The reading came back in an unexpected shape.',
    )
  })

  it('tells each kind of failure in words the owner can act on', async () => {
    const cases: [AiFailure, RegExp][] = [
      ['key', /API key was not accepted/],
      ['busy', /^Claude is busy right now/],
      ['too_large', /too large for Claude/],
      ['bad_request', /could not open this file/],
      ['model', /isn't available from Anthropic\. Choose another in Settings, then AI models/],
      ['rejected', /could not take the request just now/],
      ['unreachable', /could not reach Claude/],
      ['failed', /had a problem reading/],
    ]
    for (const [failure, message] of cases) {
      const told = readerErrorFrom(new AiProviderError(failure))
      expect(told).toBeInstanceOf(ReaderError)
      expect((told as ReaderError).message).toMatch(message)
    }
    // Anything else, like the limit, passes through as it is.
    const limit = new AiLimitError('limit', '2026-12-01')
    expect(readerErrorFrom(limit)).toBe(limit)

    const { reader, provider } = documentReaderWith()
    provider.reply = new AiProviderError('busy')
    expect((await readFailure(reader)).message).toMatch(/^Claude is busy/)
    provider.inputTokens = new AiProviderError('unreachable')
    await expect(reader.countPaystubTokens(checkPaystubFile(pdf()))).rejects.toThrow(
      'Leeway could not reach Claude. Try again in a moment.',
    )
    // A model Anthropic doesn't have says where to pick another, from a count or a read.
    const missing = /isn't available from Anthropic/
    provider.inputTokens = new AiProviderError('model')
    await expect(reader.countPaystubTokens(checkPaystubFile(pdf()))).rejects.toThrow(missing)
    provider.inputTokens = 2_000
    provider.reply = new AiProviderError('model')
    expect((await readFailure(reader)).message).toMatch(missing)
  })
})

describe('aiServices', () => {
  it('has no AI at all without a key', () => {
    expect(aiServices({ anthropic: null, modelOverrides: NO_OVERRIDES }, ctx.db, ctx.now)).toEqual({
      ai: null,
      writer: null,
      paystubs: null,
    })
  })

  it('builds the usage layer and both jobs on it from a key, without calling anything', () => {
    const services = aiServices(
      { anthropic: { apiKey: 'test-key' }, modelOverrides: NO_OVERRIDES },
      ctx.db,
      ctx.now,
    )
    expect(services.ai?.name).toBe('Claude')
    expect(services.writer).toBeInstanceOf(AiSummaryWriter)
    expect(services.paystubs).toBeInstanceOf(PaystubReader)
    expect(services.paystubs?.readerName).toBe('Claude')
  })
})
