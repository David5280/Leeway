import { describe, expect, it } from 'vitest'
import { agentJson, OWNER_ONLY_FIELDS } from '../src/mcp/agentOutput.js'

describe('agentJson', () => {
  it('leaves out owner-only fields at any depth, and keeps everything else', () => {
    const result = {
      mask: '1111',
      accounts: [
        {
          id: 'a',
          name: 'Chase Total Checking',
          bankName: 'TOTAL CHECKING ...2222',
          mask: '2222',
          nested: { mask: '3333', bankName: 'SAVINGS 3333', kept: 1 },
        },
      ],
      // Banks name their exports by account number.
      imports: [{ id: 'i', fileName: 'Chase4417_Activity20261119.CSV', rows: 3 }],
    }
    expect(JSON.parse(agentJson(result))).toEqual({
      accounts: [{ id: 'a', name: 'Chase Total Checking', nested: { kept: 1 } }],
      imports: [{ id: 'i', rows: 3 }],
    })
    expect(OWNER_ONLY_FIELDS).toEqual(new Set(['mask', 'bankName', 'fileName']))
  })

  it('leaves sentences as they were built', () => {
    // Names in sentences are clean from the start (accountName.ts), so nothing is rewritten.
    const result = { headline: 'Paid 4417 on 2026-04-17.' }
    expect(JSON.parse(agentJson(result))).toEqual(result)
  })

  it('indents like any tool result and passes plain values through', () => {
    expect(agentJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(agentJson([1, 'two', null])).toBe(JSON.stringify([1, 'two', null], null, 2))
  })
})
