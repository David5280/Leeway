// What Chat sends a model about sinking fund suggestions, read from real rows
// through the tools: a cost whose name could be a person's reads by its
// label, but keeps its real key, so a dismissal by that key sticks. Every
// name is made up.

import { describe, expect, it } from 'vitest'
import { actionCaller } from './actionCaller.js'
import { useChatProbe } from './chatProbe.js'

const probe = useChatProbe()
const { call } = actionCaller(() => probe.ctx)

interface SentSuggestion {
  key: string
  name: string
}

/** The suggestions list_sinking_funds sends a model. */
async function sentSuggestions(): Promise<SentSuggestion[]> {
  const sent = JSON.parse(await probe.sent('list_sinking_funds')) as {
    suggestions: SentSuggestion[]
  }
  return sent.suggestions
}

describe('sinking fund suggestions in Chat', () => {
  it('read by their label, keep their key, and stay gone once dismissed by it', async () => {
    await probe.pay('JANE DOUGHTY ANNUAL MEMBERSHIP', 20_000, { date: '2025-12-15' })
    const [found] = await sentSuggestions()
    expect(found!.name).not.toMatch(/doughty/i)
    // The key is the one the app holds, not the label in its place.
    const { suggestions } = await call('list_sinking_funds')
    expect(found!.key).toBe(suggestions[0]!.key)
    expect(found!.key).not.toMatch(/doughty/i)

    // Chat's own tools only read, so the dismissal goes through the action an assistant uses.
    await call('dismiss_sinking_fund', { key: found!.key })
    expect(await sentSuggestions()).toEqual([])
    expect((await call('list_sinking_funds')).suggestions).toEqual([])
  })
})
