// Labels whose names are words too, or short, as a tool's output shows them:
// a given name that is an everyday word ("Bill", "June") is someone where a
// person is named, a name of two letters is hidden where one is plainly
// named, a shop named like a person vouches for no label, and the ordinary
// words budgets are named with stay. Every name is made up.

import { describe, expect, it } from 'vitest'
import { pairs, shown, shownWith } from './labelsShown.js'

/** The labels of a list that a tool's output does not show as written. */
const changed = (labels: readonly string[]) =>
  pairs(labels).filter(([label, reads]) => label !== reads)

describe('a given name that is an everyday word', () => {
  it('is someone after a word a person is named after, kin and titles included', () => {
    expect(
      pairs(['Gift for Bill', 'Venmo Bill', 'Zelle to Bill', 'Allowance for Bill', 'Uncle Bill']),
    ).toEqual([
      ['Gift for Bill', 'Gift for someone'],
      ['Venmo Bill', 'Venmo someone'],
      ['Zelle to Bill', 'Zelle to someone'],
      ['Allowance for Bill', 'Allowance for someone'],
      ['Uncle Bill', 'Uncle someone'],
    ])
    expect(pairs(['Zelle to June', 'Grandma June', 'Mrs June', 'Cousin Bill'])).toEqual([
      ['Zelle to June', 'Zelle to someone'],
      ['Grandma June', 'Grandma someone'],
      ['Mrs June', 'Mrs someone'],
      ['Cousin Bill', 'Cousin someone'],
    ])
  })

  it('is someone leading a label, beside an unknown word or alone in a part', () => {
    expect(
      pairs([
        'Bill tuition',
        'Bill college fund',
        'BILL ALLOWANCE',
        'Bill Smith',
        'June allowance',
      ]),
    ).toEqual([
      ['Bill tuition', 'someone tuition'],
      ['Bill college fund', 'someone college fund'],
      ['BILL ALLOWANCE', 'someone ALLOWANCE'],
      ['Bill Smith', 'someone someone'],
      ['June allowance', 'someone allowance'],
    ])
    expect(pairs(['Bill Ostrowski loan', 'Loan from June Ostrowski', 'Braces - Bill'])).toEqual([
      ['Bill Ostrowski loan', 'someone someone loan'],
      ['Loan from June Ostrowski', 'Loan from someone someone'],
      ['Braces - Bill', 'Braces - someone'],
    ])
  })

  it('stays the word where it means the word', () => {
    const labels = ['Electric bill', 'Bills', 'Bill pay', 'Bill payments', 'Phone bill', 'Bill']
    expect(changed([...labels, 'Due in June', 'May rent', 'Rent for May'])).toEqual([])
    // Alone in a part, a month reads as a name too: a word lost, rather than a name shown.
    expect(shown(['Water bill - June'])).toEqual(['Water bill - someone'])
  })

  it('is hidden in a rule pattern wherever the pattern is written', () => {
    // A rule's pattern is written in capitals, and may be shown in lower case,
    // where it reads as the pattern does.
    const texts = ['VENMO BILL', 'Paid venmo bill twice']
    expect(shownWith(['VENMO BILL'], texts)).toEqual(['VENMO someone', 'Paid VENMO someone twice'])
  })
})

describe('a name of two letters', () => {
  it('is hidden when it is a given name, or named by kin, a title or a payment app', () => {
    expect(pairs(['Zelle to Ed', 'Jo allowance', 'Venmo Bo', 'Uncle Al', 'Gift for Ed'])).toEqual([
      ['Zelle to Ed', 'Zelle to someone'],
      ['Jo allowance', 'someone allowance'],
      ['Venmo Bo', 'Venmo someone'],
      ['Uncle Al', 'Uncle someone'],
      ['Gift for Ed', 'Gift for someone'],
    ])
  })

  it('stays when it is no given name and no one names it', () => {
    expect(changed(['Trip to LA', 'TV', 'Q4 taxes', 'Gift for TV'])).toEqual([])
  })
})

describe('a payment app before a name', () => {
  it('names a person after Apple Cash, Chime and Square Cash too', () => {
    expect(pairs(['Apple Cash Ignatius', 'Chime Hope', 'Square Cash Brown'])).toEqual([
      ['Apple Cash Ignatius', 'Apple Cash someone'],
      ['Chime Hope', 'Chime someone'],
      ['Square Cash Brown', 'Square Cash someone'],
    ])
  })
})

describe('a shop of one word named like a person', () => {
  it('vouches for no label that is one word with it', () => {
    const labels = ["Ross's", 'Ross’s', 'For/Ross', 'Venmo/Ross', 'Ross-allowance']
    expect(shown(labels).join(' ')).not.toMatch(/ross/i)
    expect(pairs(["Ross's", 'For/Ross'])).toEqual([
      ["Ross's", "someone's"],
      ['For/Ross', 'For/someone'],
    ])
  })
})

describe('the ordinary words budgets are named with', () => {
  it('show as written', () => {
    const labels = ['Coffee Shops', 'Pay off', 'Pay back', 'Cell Phone', 'Hotels', 'Plants']
    expect(changed([...labels, 'Halloween', 'Oil Change', 'Meal Prep', 'Plant'])).toEqual([])
  })
})
