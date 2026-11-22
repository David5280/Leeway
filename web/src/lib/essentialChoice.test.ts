import { describe, expect, it } from 'vitest'
import { essentials, fundView } from '../test/emergency'
import { category } from '../test/fake'
import { canPickEssentials, essentialSections, quietPicks, startingTicks } from './essentialChoice'

const RENT = category('Rent', { group: 'Home' })
const POWER = category('Power', { group: 'Home' })
const GROCERIES = category('Groceries', { group: 'Food' })
const PETS = category('Pets')
const SPENDING = [RENT, PETS, GROCERIES, POWER]

const bills = essentials({ from: 'bills', categories: null, categoryIds: null })
const picked = (pickedIds: string[]) => ({ pickedIds, spentIds: [] })

describe('whether the essentials can be picked', () => {
  it('can when spending sizes the fund, or whenever the owner has a pick', () => {
    expect(canPickEssentials(fundView())).toBe(true)
    expect(
      canPickEssentials(fundView({ essentials: bills, essentialsChoice: picked(['x']) })),
    ).toBe(true)
    expect(canPickEssentials(fundView({ essentials: null, essentialsChoice: picked(['x']) }))).toBe(
      true,
    )
  })

  it('cannot from bills alone, or with nothing known and no pick', () => {
    expect(canPickEssentials(fundView({ essentials: bills }))).toBe(false)
    expect(canPickEssentials(fundView({ essentials: null }))).toBe(false)
  })
})

describe('what the picker starts ticked', () => {
  it("starts from the owner's pick, then what Leeway found, then all spending", () => {
    const pick = fundView({ essentials: bills, essentialsChoice: picked(['cat-rent']) })
    expect(startingTicks(pick, SPENDING)).toEqual(['cat-rent'])
    expect(startingTicks(fundView(), SPENDING)).toEqual(['cat-rent', 'cat-groceries'])
    const all = fundView({ essentials: essentials({ categoryIds: null, categories: null }) })
    expect(startingTicks(all, SPENDING)).toEqual([
      'cat-rent',
      'cat-pets',
      'cat-groceries',
      'cat-power',
    ])
  })
})

describe("the picker's sections", () => {
  it('lists what counts now first, then the rest by group, ungrouped last as Other', () => {
    const sections = essentialSections(SPENDING, ['cat-groceries', 'cat-rent'])
    expect(sections.map((s) => [s.title, s.categories.map((c) => c.name)])).toEqual([
      ['Counted now', ['Rent', 'Groceries']],
      ['Home', ['Power']],
      ['Other', ['Pets']],
    ])
  })

  it('has no Counted now heading when nothing counts', () => {
    expect(essentialSections([PETS], []).map((s) => s.title)).toEqual(['Other'])
  })
})

describe('ticked categories that add nothing', () => {
  it('names the ticked ones with no spending, in list order', () => {
    const ticked = ['cat-power', 'cat-rent', 'cat-pets']
    expect(quietPicks(SPENDING, ticked, ['cat-rent'])).toEqual(['Pets', 'Power'])
    expect(quietPicks(SPENDING, ['cat-rent'], ['cat-rent'])).toEqual([])
  })
})
