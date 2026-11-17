import { describe, expect, it } from 'vitest'
import { transaction } from '../../test/fake'
import { groupByDay, rangeStart } from './filters'

describe('rangeStart', () => {
  const now = Date.UTC(2026, 10, 17, 18, 0)

  it('starts "this period" where the budget period starts', () => {
    expect(rangeStart('period', '2026-11-01', 'UTC', now)).toBe('2026-11-01')
  })

  it('waits for the period when it is not known yet', () => {
    expect(rangeStart('period', undefined, 'UTC', now)).toBeUndefined()
  })

  it('counts 30 days back in the owner time zone', () => {
    expect(rangeStart('30', '2026-11-01', 'America/Denver', now)).toBe('2026-10-18')
  })

  it('has no start for all time', () => {
    expect(rangeStart('all', '2026-11-01', 'UTC', now)).toBeUndefined()
  })
})

describe('groupByDay', () => {
  it('groups newest-first transactions by day, keeping the order', () => {
    const txs = [
      transaction({ id: 'a', date: '2026-11-17', name: 'A' }),
      transaction({ id: 'b', date: '2026-11-17', name: 'B' }),
      transaction({ id: 'c', date: '2026-11-15', name: 'C' }),
    ]
    expect(groupByDay(txs).map(([day, items]) => [day, items.map((t) => t.id)])).toEqual([
      ['2026-11-17', ['a', 'b']],
      ['2026-11-15', ['c']],
    ])
  })

  it('returns nothing for no transactions', () => {
    expect(groupByDay([])).toEqual([])
  })
})
