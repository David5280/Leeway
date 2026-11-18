import { describe, expect, it } from 'vitest'
import { groupBy, groupNames } from './groups'

const item = (name: string, group: string | null) => ({ name, group })

describe('groupBy', () => {
  it('keeps groups in the order they first appear and items in order within each', () => {
    const items = [
      item('Groceries', 'Food'),
      item('Rent', 'Home'),
      item('Coffee', 'Food'),
      item('Utilities', 'Home'),
    ]
    expect(groupBy(items, (i) => i.group)).toEqual([
      { group: 'Food', items: [items[0], items[2]] },
      { group: 'Home', items: [items[1], items[3]] },
    ])
  })

  it('puts items without a group last, wherever they started', () => {
    const items = [item('Mine', null), item('Groceries', 'Food')]
    expect(groupBy(items, (i) => i.group).map((g) => g.group)).toEqual(['Food', null])
  })

  it('returns nothing for nothing', () => {
    expect(groupBy([], () => null)).toEqual([])
  })
})

describe('groupNames', () => {
  it('lists each group once, in order, skipping categories without one', () => {
    const categories = [item('a', 'Food'), item('b', null), item('c', 'Home'), item('d', 'Food')]
    expect(groupNames(categories)).toEqual(['Food', 'Home'])
  })
})
