// Which words of a label the owner wrote Chat reads as a person's, from the
// label as written to what a tool's output shows of it: a given name is a
// person but in a few set phrases, a surname is the word unless owned or
// beside a name, and a shop of one word keeps its name unless it is named
// like a person. When in doubt a word is hidden. Every name is made up.

import { describe, expect, it } from 'vitest'
import { WORDS_IN_LABELS } from '../src/domain/chat/commonWords.js'
import { isGivenName } from '../src/domain/chat/givenNames.js'
import { pairs, shown } from './labelsShown.js'

describe('a given name in a label', () => {
  it('is a person, whatever word it is beside', () => {
    expect(
      pairs([
        "Grant's birthday",
        "Holly's braces",
        'Miles allowance',
        'Hunter daycare',
        'Autumn tuition',
        'Lane soccer',
        'Grant tutoring',
        "Will's car",
        "Bill's car",
      ]),
    ).toEqual([
      ["Grant's birthday", "someone's birthday"],
      ["Holly's braces", "someone's braces"],
      ['Miles allowance', 'someone allowance'],
      ['Hunter daycare', 'someone daycare'],
      ['Autumn tuition', 'someone tuition'],
      ['Lane soccer', 'someone soccer'],
      ['Grant tutoring', 'someone tutoring'],
      ["Will's car", "someone's car"],
      ["Bill's car", "someone's car"],
    ])
  })

  it('is a person after a payment app, a rule pattern in capitals included', () => {
    expect(pairs(['Venmo Grant', 'Zelle - Hope', 'Cash App Brown', 'PayPal Lane'])).toEqual([
      ['Venmo Grant', 'Venmo someone'],
      ['Zelle - Hope', 'Zelle - someone'],
      ['Cash App Brown', 'Cash App someone'],
      ['PayPal Lane', 'PayPal someone'],
    ])
    expect(shown(['VENMO GRANT'])).toEqual(['VENMO someone'])
  })

  it('stays the word only in a set phrase', () => {
    const phrases = ['Hope chest', 'Rose Garden', 'Will & Trust', 'Summer camp', 'Dog walker']
    expect(shown(phrases)).toEqual(phrases)
    // Once the label names someone, the word goes everywhere in it: a little lost, no one shown.
    expect(shown(['Hope chest for Hope'])).toEqual(['someone chest for someone'])
  })

  it('is never one of the surnames a label may read as the word', () => {
    expect([...WORDS_IN_LABELS].filter(isGivenName)).toEqual([])
    for (const name of ['grant', 'holly', 'hope', 'miles', 'rose', 'autumn', 'summer', 'hunter'])
      expect([name, isGivenName(name)]).toEqual([name, true])
  })
})

describe('a surname that is also a word', () => {
  it('stays the word alone, not owned and beside no other name', () => {
    const words = ['Green fees', 'Price Club', 'Black Friday', 'Gray Water']
    expect(shown(words)).toEqual(words)
  })

  it('is a person when owned, after a word that could be a name, or before a given name', () => {
    expect(pairs(["Brown's tuition", 'Hope Brown', 'Ignatius Brown', 'Brown Hope'])).toEqual([
      ["Brown's tuition", "someone's tuition"],
      ['Hope Brown', 'someone someone'],
      ['Ignatius Brown', 'someone someone'],
      ['Brown Hope', 'someone someone'],
    ])
  })

  it('stays the word beside an ordinary word, which is hidden alone when no rule vouches for it', () => {
    const labels = ['Brown rice', 'Young Living', 'Hill Country', 'Love Sac', 'Stone countertops']
    expect(pairs(labels)).toEqual([
      ['Brown rice', 'Brown someone'],
      ['Young Living', 'Young someone'],
      ['Hill Country', 'Hill someone'],
      ['Love Sac', 'Love someone'],
      ['Stone countertops', 'Stone someone'],
    ])
    // A surname first beside an unknown word reads as the word, as "Hill Country" does.
    expect(shown(['Brown Ignatius'])).toEqual(['Brown someone'])
  })
})

describe("a shop's name of one word", () => {
  it('shows as written when it is named for no one', () => {
    const labels = ['Wegmans groceries', 'Marshalls clothes', 'Target runs', 'Costco trips']
    expect(shown(labels)).toEqual(labels)
  })

  it('vouches for nothing when it is a given name too', () => {
    expect(pairs(['Ross allowance', "Ruby's Savings"])).toEqual([
      ['Ross allowance', 'someone allowance'],
      ["Ruby's Savings", "someone's Savings"],
    ])
  })
})
