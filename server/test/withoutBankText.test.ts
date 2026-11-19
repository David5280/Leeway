import { describe, expect, it } from 'vitest'
import { withoutBankText } from '../src/mcp/withoutBankText.js'

const tx = {
  id: 't1',
  name: 'ONLINE TRANSFER FROM CHK XXXXXX9876',
  merchantName: 'CHK 9876',
  displayName: 'Transfer from Checking',
  amountCents: -50000,
}

describe('withoutBankText', () => {
  it("takes the bank's text out of a transaction, keeping its clean name", () => {
    expect(withoutBankText(tx)).toEqual({
      id: 't1',
      displayName: 'Transfer from Checking',
      amountCents: -50000,
    })
  })

  it('finds transactions at any depth: in lists, and inside other results', () => {
    const view = { transactions: [tx], recent: { examples: [tx] }, total: 1 }
    expect(JSON.stringify(withoutBankText(view))).not.toMatch(/9876/)
  })

  it('leaves other objects with a name alone, and dates and plain values as they were', () => {
    const synced = new Date('2026-11-17T12:00:00Z')
    const output = { name: 'Groceries', categories: [{ id: 'c', name: 'Coffee' }], synced, n: 3 }
    expect(withoutBankText(output)).toEqual(output)
    expect((withoutBankText(output) as { synced: Date }).synced).toBe(synced)
    expect(withoutBankText(null)).toBeNull()
    expect(withoutBankText('text')).toBe('text')
    expect(withoutBankText(Object.assign(Object.create(null), { a: 1 }))).toEqual({ a: 1 })
  })
})
