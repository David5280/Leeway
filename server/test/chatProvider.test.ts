// A Chat step through the Anthropic provider: what is sent (cache marks
// included), how the stream's words and the reply are read, and how a
// failure is told, through a fake SDK client so no test calls the API.

import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { AnthropicProvider, type MessagesClient } from '../src/ai/anthropic.js'
import { chatParams, chatReplyOf } from '../src/ai/anthropicChat.js'
import { AiProviderError, type AiChatRequest } from '../src/ai/provider.js'

const REQUEST: AiChatRequest = {
  model: 'claude-haiku-5-5',
  system: 'You are a money coach.',
  context: 'Today is Tuesday, 2026-11-17.',
  tools: [
    {
      name: 'get_budget',
      description: 'The budget.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  messages: [
    { role: 'user', text: 'Am I on track?' },
    { role: 'assistant', text: 'Yes.' },
    { role: 'user', text: 'And now?' },
    { role: 'assistant', turn: [{ type: 'thinking', thinking: '', signature: 'sig' }] },
    { role: 'tool_results', results: [{ id: 'tu_1', content: '{"ok":true}', isError: false }] },
  ],
  effort: 'low',
  maxTokens: 4000,
}

/** A finished message as the SDK's stream gives it. */
function message(fields: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 120 },
    ...fields,
  } as Anthropic.Message
}

/** A provider on a client whose stream sends these pieces of text, then ends or fails. */
function providerStreaming(pieces: string[], end: Anthropic.Message | Error) {
  const sent: unknown[] = []
  const client = {
    messages: {
      stream: (params: unknown) => {
        sent.push(params)
        let onText: (text: string) => void = () => {}
        return {
          on: (_event: 'text', listener: (text: string) => void) => {
            onText = listener
          },
          finalMessage: async () => {
            for (const piece of pieces) onText(piece)
            if (end instanceof Error) throw end
            return end
          },
        }
      },
    },
  } as unknown as MessagesClient
  return { provider: new AnthropicProvider('test-key', client), sent }
}

describe('a Chat request', () => {
  it('caches the tools and fixed instructions, then the history, with the day after the mark', () => {
    const params = chatParams(REQUEST)
    expect(params.system).toEqual([
      { type: 'text', text: 'You are a money coach.', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Today is Tuesday, 2026-11-17.' },
    ])
    expect(params.cache_control).toEqual({ type: 'ephemeral' })
    expect(params.tools).toEqual([
      {
        name: 'get_budget',
        description: 'The budget.',
        input_schema: { type: 'object', properties: {} },
      },
    ])
    expect(params).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 4000,
      output_config: { effort: 'low' },
    })
  })

  it('passes a reply that called tools back unchanged, and sends results as the next turn', () => {
    expect(chatParams(REQUEST).messages).toEqual([
      { role: 'user', content: 'Am I on track?' },
      { role: 'assistant', content: 'Yes.' },
      { role: 'user', content: 'And now?' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'sig' }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":true}', is_error: false },
        ],
      },
    ])
  })
})

describe('reading a Chat reply', () => {
  it('reads its words, the tools it asked for, the whole reply to pass back, and the tokens', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Let me ' },
      { type: 'text', text: 'look.' },
      { type: 'tool_use', id: 'tu_1', name: 'get_budget', input: { offset: 0 } },
    ] as Anthropic.ContentBlock[]
    const reply = chatReplyOf(
      message({
        content,
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 50,
          output_tokens: 80,
          cache_read_input_tokens: 9_000,
          cache_creation_input_tokens: 400,
        } as Anthropic.Usage,
      }),
    )
    expect(reply).toEqual({
      stop: 'tools',
      text: 'Let me look.',
      toolCalls: [{ id: 'tu_1', name: 'get_budget', input: { offset: 0 } }],
      turn: content,
      usage: { inputTokens: 50, outputTokens: 80, cacheReadTokens: 9_000, cacheWriteTokens: 400 },
    })
  })

  it('tells finishing, declining and running out of room apart', () => {
    expect(chatReplyOf(message({ stop_reason: 'end_turn' })).stop).toBe('done')
    expect(chatReplyOf(message({ stop_reason: 'refusal' })).stop).toBe('refused')
    expect(chatReplyOf(message({ stop_reason: 'max_tokens' })).stop).toBe('cut_off')
  })
})

describe('AnthropicProvider.converse', () => {
  it('streams the words as they arrive and returns the reply', async () => {
    const done = message({
      content: [{ type: 'text', text: 'All good.' }] as Anthropic.ContentBlock[],
    })
    const { provider, sent } = providerStreaming(['All ', 'good.'], done)
    const heard: string[] = []
    const reply = await provider.converse(REQUEST, (text) => heard.push(text))
    expect(heard).toEqual(['All ', 'good.'])
    expect(reply).toMatchObject({ stop: 'done', text: 'All good.', usage: { inputTokens: 900 } })
    expect(sent).toEqual([chatParams(REQUEST)])
  })

  it('tells a failure by its kind, never by what was sent', async () => {
    const error = new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers())
    const { provider } = providerStreaming(['Par'], error)
    const failure = await provider.converse(REQUEST, () => {}).catch((e: unknown) => e)
    expect(failure).toEqual(new AiProviderError('busy'))
  })
})
