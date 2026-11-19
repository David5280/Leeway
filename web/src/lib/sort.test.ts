import { describe, expect, it } from 'vitest'
import { byName, compareNames } from './sort'

const names = (items: { name: string }[]) => items.map((item) => item.name)

describe('byName', () => {
  it('ignores case, so lowercase names do not sink to the end', () => {
    const sorted = byName([{ name: 'groceries' }, { name: 'Bills' }, { name: 'auto' }])
    expect(names(sorted)).toEqual(['auto', 'Bills', 'groceries'])
  })

  it('ignores accents and sorts numbers by value', () => {
    const sorted = byName([{ name: 'Card 10' }, { name: 'Éducation' }, { name: 'Card 2' }])
    expect(names(sorted)).toEqual(['Card 2', 'Card 10', 'Éducation'])
  })

  it('leaves the input in its order', () => {
    const items = [{ name: 'b' }, { name: 'a' }]
    byName(items)
    expect(names(items)).toEqual(['b', 'a'])
  })

  it('follows the locale', () => {
    // Swedish puts Ö after Z; English treats it as O.
    expect(compareNames('Öl', 'Zebra', 'sv')).toBeGreaterThan(0)
    expect(compareNames('Öl', 'Zebra', 'en-US')).toBeLessThan(0)
  })
})
