// The Anthropic provider: what one request sends, what comes back, and how a
// failure is told, through a fake SDK client so no test calls the API.

import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AnthropicProvider, failureFrom, type MessagesClient } from '../src/ai/anthropic.js'
import { AiProviderError, type AiRequest } from '../src/ai/provider.js'

/** What the SDK's parse() answers. */
interface FakeResponse {
  stop_reason: string | null
  parsed_output: unknown
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
  }
}

const ANSWER: FakeResponse = {
  stop_reason: 'end_turn',
  parsed_output: { headline: 'Fine.' },
  usage: { input_tokens: 1_850, output_tokens: 640 },
}

/** A provider on a client that answers every request, or throws, and records each one. */
function providerWith(answer: FakeResponse | Error = ANSWER, count: number | Error = 4_200) {
  const sent: Record<string, unknown>[] = []
  const counted: Record<string, unknown>[] = []
  const settle = <T>(value: T | Error) =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  const client = {
    messages: {
      parse: (request: Record<string, unknown>) => {
        sent.push(request)
        return settle(answer)
      },
      countTokens: (request: Record<string, unknown>) => {
        counted.push(request)
        return settle(count instanceof Error ? count : { input_tokens: count })
      },
    },
  } as unknown as MessagesClient
  return { provider: new AnthropicProvider('test-key', client), sent, counted }
}

const REQUEST: AiRequest = {
  model: 'claude-haiku-5-5',
  system: 'Write a headline.',
  content: [{ type: 'text', text: 'Facts: you are on track.' }],
  format: z.object({ headline: z.string() }),
  effort: 'low',
  maxTokens: 4000,
}

const pdfBytes = Buffer.from('%PDF-1.7 a paystub')

describe('AnthropicProvider', () => {
  it('sends the model, the instructions, the content and the shape, and nothing more', async () => {
    const { provider, sent } = providerWith()
    const reply = await provider.send(REQUEST)
    expect(reply).toEqual({
      stop: 'done',
      output: { headline: 'Fine.' },
      usage: { inputTokens: 1_850, outputTokens: 640, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    expect(provider.name).toBe('Claude')
    const request = sent[0]!
    expect(Object.keys(request).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'output_config',
      'system',
    ])
    expect(request).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 4000,
      system: 'Write a headline.',
      output_config: { effort: 'low', format: expect.anything() },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Facts: you are on track.' }] }],
    })
  })

  it('sends a PDF as a document and a photo as an image, before the text', async () => {
    const { provider, sent } = providerWith()
    const files = [
      { mediaType: 'application/pdf', type: 'document' },
      { mediaType: 'image/png', type: 'image' },
      { mediaType: 'image/jpeg', type: 'image' },
    ] as const
    for (const { mediaType, type } of files) {
      await provider.send({
        ...REQUEST,
        content: [{ type: 'file', mediaType, data: pdfBytes }, REQUEST.content[0]!],
      })
      const [message] = sent.at(-1)!.messages as { content: unknown[] }[]
      expect(message!.content).toEqual([
        {
          type,
          source: { type: 'base64', media_type: mediaType, data: pdfBytes.toString('base64') },
        },
        { type: 'text', text: 'Facts: you are on track.' },
      ])
    }
  })

  it('reports cache reads and writes apart from plain input', async () => {
    const { provider } = providerWith({
      ...ANSWER,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 3_000,
        cache_creation_input_tokens: 200,
      },
    })
    expect((await provider.send(REQUEST)).usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3_000,
      cacheWriteTokens: 200,
    })
    const nulls = providerWith({
      ...ANSWER,
      usage: { ...ANSWER.usage, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    })
    expect((await nulls.provider.send(REQUEST)).usage.cacheReadTokens).toBe(0)
  })

  it('says when the model declined, ran out of room, or gave no answer', async () => {
    const stops: [string | null, string][] = [
      ['refusal', 'refused'],
      ['max_tokens', 'cut_off'],
      ['end_turn', 'done'],
      [null, 'done'],
    ]
    for (const [reason, stop] of stops) {
      const { provider } = providerWith({
        ...ANSWER,
        stop_reason: reason,
        parsed_output: undefined,
      })
      expect(await provider.send(REQUEST)).toMatchObject({ stop, output: null })
    }
  })

  it('counts exactly the request a send makes, without its max tokens', async () => {
    const { provider, sent, counted } = providerWith()
    expect(await provider.count(REQUEST)).toBe(4_200)
    await provider.send(REQUEST)
    const { max_tokens, ...rest } = sent[0]!
    expect(max_tokens).toBe(4000)
    // As JSON, since each request builds its own schema parser.
    expect(JSON.stringify(counted[0])).toBe(JSON.stringify(rest))
  })

  it("tells each SDK failure by its kind, never in the SDK's own words", async () => {
    const secret = 'request quoted: Gross Pay 3,845.00'
    const headers = new Headers()
    const cases: [unknown, string][] = [
      [new Anthropic.AuthenticationError(401, {}, secret, headers), 'key'],
      [new Anthropic.PermissionDeniedError(403, {}, secret, headers), 'key'],
      [new Anthropic.RateLimitError(429, {}, secret, headers), 'busy'],
      [new Anthropic.ContentTooLargeError(413, {}, secret, headers), 'too_large'],
      [new Anthropic.BadRequestError(400, {}, secret, headers), 'bad_request'],
      [new Anthropic.APIConnectionError({ message: secret }), 'unreachable'],
      [new Anthropic.InternalServerError(500, {}, secret, headers), 'failed'],
      [new Error(secret), 'failed'],
    ]
    for (const [error, failure] of cases) {
      const told = failureFrom(error)
      expect(told).toBeInstanceOf(AiProviderError)
      expect(told.failure).toBe(failure)
      expect(told.message).not.toContain('3,845')
    }
    const sending = providerWith(new Anthropic.RateLimitError(429, {}, secret, headers))
    await expect(sending.provider.send(REQUEST)).rejects.toMatchObject({ failure: 'busy' })
    const counting = providerWith(ANSWER, new Anthropic.APIConnectionError({ message: secret }))
    await expect(counting.provider.count(REQUEST)).rejects.toMatchObject({ failure: 'unreachable' })
  })

  it('builds its own SDK client from the key when given none, without calling it', () => {
    expect(new AnthropicProvider('test-key').name).toBe('Claude')
  })
})
