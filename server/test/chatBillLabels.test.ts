// Which bills Chat shows by a label because what they track is labelled, and
// whether their name goes too. Every name is made up.

import { describe, expect, it } from 'vitest'
import { labelBills, wordsOf, type StoredBill } from '../src/domain/chat/billLabels.js'

/** A bill as stored, reading bank text unless a case says otherwise. */
const bill = (
  id: string,
  name: string,
  matchPattern: string | null,
  shown = false,
): StoredBill => ({
  id,
  name,
  matchPattern,
  reads: shown ? 'shown_name' : 'bank_text',
})

/** Labelled payments out: one to a person through Zelle, one by bank transfer. */
const payments = [
  {
    label: 'Zelle payment (sent)',
    bankKey: 'zelle payment to jane doughty jpm',
    shownKey: 'to jane doughty',
  },
  {
    label: 'Transfer to another account',
    bankKey: 'online transfer to clara thornbury everyday checking',
    shownKey: 'transfer to clara thornbury everyday checking',
  },
]

describe('a bill tracking labelled payments', () => {
  it("takes the label of the payment its pattern's whole words are in", () => {
    const bills = [
      bill('a', 'To Jane Doughty', 'zelle payment to jane doughty'),
      bill('b', 'Rent', 'thornbury'),
      bill('c', 'Jane', 'to jane', true),
    ]
    expect(labelBills(bills, payments, new Set())).toEqual(
      new Map([
        ['a', { label: 'Zelle payment (sent)', renamed: true }],
        ['b', { label: 'Transfer to another account', renamed: false }],
        ['c', { label: 'Zelle payment (sent)', renamed: true }],
      ]),
    )
  })

  it('keeps its name only when every word is an everyday or business one', () => {
    const bills = [
      bill('a', 'Cleaner', 'thornbury'),
      bill('b', 'House cleaning', 'thornbury'),
      bill('c', 'Abercrombie loan', 'thornbury'),
      bill('d', 'Hawthorne', 'thornbury'),
      // A word that is hidden is renamed even when it is an everyday one.
      bill('e', 'Rose', 'thornbury'),
      // So is one holding a full name hidden, though its words are everyday ones.
      bill('f', 'Ally Auto loan', 'thornbury'),
      bill('g', 'Ally loan', 'thornbury'),
    ]
    const renamed = [...labelBills(bills, payments, new Set(['rose']), ['Ally Auto'])].map(
      ([id, shown]) => [id, shown.renamed],
    )
    expect(renamed).toEqual([
      ['a', false],
      ['b', false],
      ['c', true],
      ['d', true],
      ['e', true],
      ['f', true],
      ['g', false],
    ])
  })

  it('takes none from a word inside another, or a payment it does not read', () => {
    const bills = [
      bill('a', 'Rent', 'rent'),
      bill('b', 'Chase card', 'chase'),
      bill('c', 'Gym', 'doughty jpm', true),
      bill('d', 'Water', null),
      bill('e', 'Odd', '1234'),
    ]
    expect(labelBills(bills, payments, new Set())).toEqual(new Map())
  })

  it('is labelled by its own words when they read as an app or a transfer, or name someone', () => {
    const bills = [
      bill('a', 'Lessons', 'zelle quillon'),
      bill('b', 'Venmo Quillon', null),
      bill('c', 'Lessons', 'quillon'),
      bill('d', "Quillon's lessons", 'music school'),
    ]
    expect(labelBills(bills, [], new Set(['quillon']))).toEqual(
      new Map([
        ['a', { label: 'Zelle payment (sent)', renamed: false }],
        ['b', { label: 'Venmo payment (sent)', renamed: true }],
        ['c', { label: 'Payment sent', renamed: false }],
      ]),
    )
  })
})

describe('the words of a text, as hidden names are compared', () => {
  it('are lower case, accents aside, split at anything not a letter', () => {
    expect(wordsOf("Núñez, Ana-María's 2 lessons")).toEqual(
      ['nunez', 'ana', 'maría', 's', 'lessons'].map((word) =>
        word.normalize('NFKD').replace(/\p{M}/gu, ''),
      ),
    )
  })
})
