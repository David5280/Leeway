import { describe, expect, it } from 'vitest'
import { agentJson, OWNER_ONLY_FIELDS } from '../src/mcp/agentOutput.js'

describe('agentJson', () => {
  it('leaves out owner-only fields at any depth, and keeps everything else', () => {
    const result = {
      mask: '1111',
      accounts: [{ id: 'a', name: 'Checking', mask: '2222', nested: { mask: '3333', kept: 1 } }],
    }
    expect(JSON.parse(agentJson(result))).toEqual({
      accounts: [{ id: 'a', name: 'Checking', nested: { kept: 1 } }],
    })
    expect(OWNER_ONLY_FIELDS).toEqual(new Set(['mask']))
  })

  it('indents like any tool result and passes plain values through', () => {
    expect(agentJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(agentJson([1, 'two', null])).toBe(JSON.stringify([1, 'two', null], null, 2))
  })
})
