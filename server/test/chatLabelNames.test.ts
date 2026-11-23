// Which words of a label the owner wrote Chat reads as a person's, from the
// label as written to what a tool's output shows of it: a given name is a
// person but in a few set phrases, a surname is the word only alone and not
// owned, and a shop of one word keeps its name unless it is named like a
// person. When in doubt a word is hidden. Every name is made up.

import { describe, expect, it } from 'vitest'
import { chatToolText } from '../src/chat/toolOutput.js'
import { WORDS_IN_LABELS } from '../src/domain/chat/commonWords.js'
import { isGivenName } from '../src/domain/chat/givenNames.js'
import { namesInLabels } from '../src/domain/chat/ownerText.js'
import { NO_PEOPLE } from '../src/domain/chat/people.js'
import { namedLabels } from '../src/domain/chat/personNames.js'
import { knownShops } from '../src/domain/knownShops.js'

// Shops the owner buys from: one-word ones named for no one, and ones named like a person.
const SHOPS = knownShops(['Wegmans', 'Marshalls', 'Target', 'Ross', 'Ruby', "Trader Joe's"])

/** Each label as a tool's output shows it, read through every step Chat takes. */
function shown(labels: readonly string[]): string[] {
  const words = namesInLabels(labels, () => false, SHOPS)
  const people = { ...NO_PEOPLE, shops: SHOPS, labels: namedLabels(words, SHOPS) }
  return (JSON.parse(chatToolText({ labels }, people)) as { labels: string[] }).labels
}

/** Each label beside how it is shown, so a failure names the label. */
const pairs = (labels: readonly string[]) => labels.map((label, at) => [label, shown(labels)[at]])

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

  it('is a person when owned or beside another name', () => {
    expect(pairs(["Brown's tuition", 'Hope Brown', 'Brown Ignatius'])).toEqual([
      ["Brown's tuition", "someone's tuition"],
      ['Hope Brown', 'someone someone'],
      ['Brown Ignatius', 'someone someone'],
    ])
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
