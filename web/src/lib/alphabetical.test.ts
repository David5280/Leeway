import { describe, expect, it } from 'vitest'
import { alphabeticalGroups, compareNames, sortByName } from './alphabetical'

const EN = 'en-US'
const named = (name: string, group: string | null = null) => ({ name, group })
const names = (items: { name: string }[]) => items.map((item) => item.name)

describe('compareNames', () => {
  it('ignores case', () => {
    expect(compareNames('apps', 'Apps', EN)).toBe(0)
    expect(compareNames('bills', 'Apps', EN)).toBeGreaterThan(0)
  })

  it('ignores accents', () => {
    expect(compareNames('Cafe', 'Café', EN)).toBe(0)
  })

  it('counts numbers by value', () => {
    expect(compareNames('Rent 2', 'Rent 10', EN)).toBeLessThan(0)
  })
})

describe('the language order', () => {
  it("follows the locale set under Region, not the browser's", () => {
    const items = [named('Zoo'), named('Öl'), named('Ost')]
    // English files Ö with O; Swedish puts it after Z.
    expect(names(sortByName(items, (i) => i.name, 'en-US'))).toEqual(['Öl', 'Ost', 'Zoo'])
    expect(names(sortByName(items, (i) => i.name, 'sv-SE'))).toEqual(['Ost', 'Zoo', 'Öl'])
  })

  it('groups categories in that order too', () => {
    const groups = alphabeticalGroups([named('a', 'Öl'), named('b', 'Zoo')], 'sv-SE')
    expect(groups.map((g) => g.group)).toEqual(['Zoo', 'Öl'])
  })
})

describe('sortByName', () => {
  it('sorts A to Z, whatever the case', () => {
    const items = [named('Transportation'), named('groceries'), named('Dining out')]
    expect(names(sortByName(items, (i) => i.name, EN))).toEqual([
      'Dining out',
      'groceries',
      'Transportation',
    ])
  })

  it('keeps names that compare equal in the order they came', () => {
    const items = [named('tv'), named('Apps'), named('TV')]
    expect(names(sortByName(items, (i) => i.name, EN))).toEqual(['Apps', 'tv', 'TV'])
  })

  it('leaves the list it was given alone', () => {
    const items = [named('b'), named('a')]
    sortByName(items, (i) => i.name, EN)
    expect(names(items)).toEqual(['b', 'a'])
  })
})

describe('alphabeticalGroups', () => {
  it('is one A to Z list when no category has a group', () => {
    const groups = alphabeticalGroups([named('Shopping'), named('Groceries'), named('Bills')], EN)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.group).toBeNull()
    expect(names(groups[0]!.categories)).toEqual(['Bills', 'Groceries', 'Shopping'])
  })

  it('sorts groups A to Z and each group A to Z, with ungrouped categories last', () => {
    const groups = alphabeticalGroups(
      [
        named('Rent', 'Home'),
        named('Mine', null),
        named('Groceries', 'food and drink'),
        named('Alcohol', 'food and drink'),
        named('Utilities', 'Home'),
        named('Another', null),
        named('Dining out', 'food and drink'),
      ],
      EN,
    )
    expect(groups.map((g) => [g.group, names(g.categories)])).toEqual([
      ['food and drink', ['Alcohol', 'Dining out', 'Groceries']],
      ['Home', ['Rent', 'Utilities']],
      [null, ['Another', 'Mine']],
    ])
  })

  it('returns nothing for no categories', () => {
    expect(alphabeticalGroups([], EN)).toEqual([])
  })
})
