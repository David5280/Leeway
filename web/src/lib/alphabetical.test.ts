import { describe, expect, it } from 'vitest'
import { alphabeticalGroups, compareNames, sortByName } from './alphabetical'

const named = (name: string, group: string | null = null) => ({ name, group })
const names = (items: { name: string }[]) => items.map((item) => item.name)

describe('compareNames', () => {
  it('ignores case', () => {
    expect(compareNames('apps', 'Apps')).toBe(0)
    expect(compareNames('bills', 'Apps')).toBeGreaterThan(0)
  })

  it('ignores accents', () => {
    expect(compareNames('Cafe', 'Café')).toBe(0)
  })

  it('counts numbers by value', () => {
    expect(compareNames('Rent 2', 'Rent 10')).toBeLessThan(0)
  })
})

describe('sortByName', () => {
  it('sorts A to Z, whatever the case', () => {
    const items = [named('Transportation'), named('groceries'), named('Dining out')]
    expect(names(sortByName(items, (i) => i.name))).toEqual([
      'Dining out',
      'groceries',
      'Transportation',
    ])
  })

  it('keeps names that compare equal in the order they came', () => {
    const items = [named('tv'), named('Apps'), named('TV')]
    expect(names(sortByName(items, (i) => i.name))).toEqual(['Apps', 'tv', 'TV'])
  })

  it('leaves the list it was given alone', () => {
    const items = [named('b'), named('a')]
    sortByName(items, (i) => i.name)
    expect(names(items)).toEqual(['b', 'a'])
  })
})

describe('alphabeticalGroups', () => {
  it('is one A to Z list when no category has a group', () => {
    const groups = alphabeticalGroups([named('Shopping'), named('Groceries'), named('Bills')])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.group).toBeNull()
    expect(names(groups[0]!.categories)).toEqual(['Bills', 'Groceries', 'Shopping'])
  })

  it('sorts groups A to Z and each group A to Z, with ungrouped categories last', () => {
    const groups = alphabeticalGroups([
      named('Rent', 'Home'),
      named('Mine', null),
      named('Groceries', 'food and drink'),
      named('Alcohol', 'food and drink'),
      named('Utilities', 'Home'),
      named('Another', null),
      named('Dining out', 'food and drink'),
    ])
    expect(groups.map((g) => [g.group, names(g.categories)])).toEqual([
      ['food and drink', ['Alcohol', 'Dining out', 'Groceries']],
      ['Home', ['Rent', 'Utilities']],
      [null, ['Another', 'Mine']],
    ])
  })

  it('returns nothing for no categories', () => {
    expect(alphabeticalGroups([])).toEqual([])
  })
})
