import { describe, expect, it } from 'vitest'
import {
  agentJson,
  maskedNameRenames,
  OWNER_ONLY_FIELDS,
  withoutMaskDigits,
} from '../src/mcp/agentOutput.js'

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

  it('takes an account’s last digits out of its names too', () => {
    const result = [
      { id: 'a', name: 'Rainy day', bankName: 'SAVINGS ...4417', mask: '4417' },
      { id: 'b', name: 'Total Checking 4417', bankName: 'TOTAL CHECKING 4417', mask: '4417' },
      // Another account's digits, or a name with no mask, are left alone.
      { id: 'c', name: 'CD 12 months', bankName: '401K 2026', mask: '9999' },
      { id: 'd', name: 'Car 2019', mask: null },
    ]
    expect(JSON.parse(agentJson(result))).toEqual([
      { id: 'a', name: 'Rainy day', bankName: 'SAVINGS' },
      { id: 'b', name: 'Total Checking', bankName: 'TOTAL CHECKING' },
      { id: 'c', name: 'CD 12 months', bankName: '401K 2026' },
      { id: 'd', name: 'Car 2019' },
    ])
  })

  it('cleans a masked account name inside sentences, by its exact name', () => {
    const renames = maskedNameRenames([
      { name: 'SAVINGS ...4417', bankName: 'SAVINGS ...4417', mask: '4417' },
      { name: 'Rainy day', bankName: 'SAVINGS ...44171', mask: '44171' },
      { name: 'Joint', bankName: 'JOINT', mask: '1234' },
      { name: 'Cash', bankName: 'Cash', mask: null },
    ])
    expect(renames).toEqual(
      new Map([
        ['SAVINGS ...4417', 'SAVINGS'],
        ['SAVINGS ...44171', 'SAVINGS'],
      ]),
    )
    const result = {
      headline: '$1,000 available in SAVINGS ...4417.',
      alerts: [{ message: 'SAVINGS ...44171 is down to $5.' }],
      // A date or amount that happens to share the digits is not a name, and stays.
      note: 'Paid 4417 on 2026-04-17.',
    }
    expect(JSON.parse(agentJson(result, renames))).toEqual({
      headline: '$1,000 available in SAVINGS.',
      alerts: [{ message: 'SAVINGS is down to $5.' }],
      note: 'Paid 4417 on 2026-04-17.',
    })
  })

  it('indents like any tool result and passes plain values through', () => {
    expect(agentJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(agentJson([1, 'two', null])).toBe(JSON.stringify([1, 'two', null], null, 2))
  })
})

describe('withoutMaskDigits', () => {
  it.each([
    ['CHECKING ...4417', 'CHECKING'],
    ['Checking ending in 4417', 'Checking'],
    ['Sapphire (XXXX-4417)', 'Sapphire'],
    ['CHK4417', 'CHK'],
    ['Card x4417 Rewards', 'Card Rewards'],
    ['00004417', 'Account'],
  ])('reads %s as %s', (name, clean) => {
    expect(withoutMaskDigits(name, '4417')).toBe(clean)
  })

  it('keeps a name that does not hold the digits, and ignores a one-digit mask', () => {
    expect(withoutMaskDigits('Joint savings', '4417')).toBe('Joint savings')
    expect(withoutMaskDigits('Savings 2', '2')).toBe('Savings 2')
    expect(withoutMaskDigits('Savings 44171', '4417')).toBe('Savings 44171')
  })
})
