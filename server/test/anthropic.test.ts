import { describe, expect, it } from 'vitest'
import { AnthropicSummaryWriter, SYSTEM_PROMPT, type MessagesClient } from '../src/ai/anthropic.js'
import type { SummaryFacts } from '../src/domain/summaryText.js'

const facts = {
  today: 'Nov 17',
  period: { kind: 'month', left: '$1,200' },
} as unknown as SummaryFacts

/** A client whose parse() answers with the given response and records the request. */
function fakeClient(response: { stop_reason: string; parsed_output: unknown }) {
  const requests: Record<string, unknown>[] = []
  const client = {
    messages: {
      parse: (request: Record<string, unknown>) => {
        requests.push(request)
        return Promise.resolve(response)
      },
    },
  } as unknown as MessagesClient
  return { client, requests }
}

const writerWith = (response: { stop_reason: string; parsed_output: unknown }) => {
  const { client, requests } = fakeClient(response)
  return {
    writer: new AnthropicSummaryWriter(
      { apiKey: 'test', model: 'claude-opus-5-5', paystubModel: 'claude-haiku-5-5' },
      client,
    ),
    requests,
  }
}

describe('AnthropicSummaryWriter', () => {
  it('asks the configured model, at low effort, for a headline and points from the facts', async () => {
    const { writer, requests } = writerWith({
      stop_reason: 'end_turn',
      parsed_output: { headline: '  You are on track.  ', points: ['Payday is Dec 1.'] },
    })
    expect(await writer.write(facts)).toEqual({
      headline: 'You are on track.',
      points: ['Payday is Dec 1.'],
    })
    expect(writer.name).toBe('Claude')
    const request = requests[0]!
    expect(request).toMatchObject({ model: 'claude-opus-5-5', system: SYSTEM_PROMPT })
    expect(request.output_config).toMatchObject({ effort: 'low' })
    expect(JSON.stringify(request.messages)).toContain('$1,200')
  })

  it('keeps an urgent account alert as the headline, whatever Claude wrote', async () => {
    const { writer } = writerWith({
      stop_reason: 'end_turn',
      parsed_output: { headline: 'You are on track.', points: ['Payday is Dec 1.'] },
    })
    const overdrawn = 'Your Chase checking account is overdrawn by $42.10.'
    const summary = await writer.write({ ...facts, fixedHeadline: overdrawn })
    expect(summary).toEqual({ headline: overdrawn, points: ['Payday is Dec 1.'] })
    expect(SYSTEM_PROMPT).toContain('fixedHeadline')
  })

  it('tells Claude never to say the person saves too little', () => {
    // The bank never sees payroll saving, and a pension is saving in itself, so any such claim could be wrong.
    expect(SYSTEM_PROMPT).toContain('a pension counts only once the person enters it')
    expect(SYSTEM_PROMPT).toContain('a pension is retirement saving in itself')
    expect(SYSTEM_PROMPT).toContain(
      'Never say or imply that the person saves too little or should save more',
    )
    expect(SYSTEM_PROMPT).not.toContain('never payroll deductions such as a pension')
  })

  it('throws when Claude declines, so the dashboard falls back to Leeway’s words', async () => {
    const { writer } = writerWith({ stop_reason: 'refusal', parsed_output: null })
    await expect(writer.write(facts)).rejects.toThrow('declined')
  })

  it('throws when the answer was cut off', async () => {
    const { writer } = writerWith({ stop_reason: 'max_tokens', parsed_output: null })
    await expect(writer.write(facts)).rejects.toThrow('cut off')
  })

  it('throws when the answer is too long or empty', async () => {
    const tooMany = writerWith({
      stop_reason: 'end_turn',
      parsed_output: { headline: 'Fine.', points: ['a', 'b', 'c', 'd', 'e'] },
    })
    await expect(tooMany.writer.write(facts)).rejects.toThrow('unexpected shape')
    const empty = writerWith({
      stop_reason: 'end_turn',
      parsed_output: { headline: ' ', points: ['a'] },
    })
    await expect(empty.writer.write(facts)).rejects.toThrow('unexpected shape')
  })

  it('builds a real SDK client when none is given', () => {
    expect(
      new AnthropicSummaryWriter({
        apiKey: 'test',
        model: 'claude-opus-5-5',
        paystubModel: 'claude-haiku-5-5',
      }).name,
    ).toBe('Claude')
  })
})
