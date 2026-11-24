// The everyday senses that vouch for "Bill", "June" and "April" in a label
// the owner wrote (chat/wordNames.ts): what is billed, a shop's name, what is
// done about a bill and a date's word, while a lone name beside a person cue
// still reads "someone". Read through every step Chat takes. Every name is
// made up.

import { describe, expect, it } from 'vitest'
import { meansTheWord } from '../src/domain/chat/wordNames.js'
import { knownShops } from '../src/domain/knownShops.js'
import { pairs, shownWith } from './labelsShown.js'

/** The labels of a list that a tool's output does not show as written, which should be none. */
const changed = (labels: readonly string[]) =>
  pairs(labels).filter(([label, reads]) => label !== reads)

describe('a month after a date word', () => {
  it('stays the month', () => {
    const labels = ['Save until June', 'Pay off thru April', 'Vacation through June']
    expect(changed([...labels, 'Since June', 'Till June'])).toEqual([])
  })
})

describe('"Bill" in its everyday sense', () => {
  it('stays before what is done about a bill, and in "Pay bill"', () => {
    const labels = ['Bill due', 'Pay bill', 'Bill reminders', 'Bill autopay']
    expect(changed([...labels, 'Phone bill autopay'])).toEqual([])
  })

  it('stays in a set phrase written with a hyphen or an underscore', () => {
    expect(changed(['Bill-pay', 'Bill_pay', 'Bill-splitting'])).toEqual([])
  })

  it('stays after a loan, rent, tuition, daycare or a car', () => {
    const labels = ['Loan bill', 'Rent bill', 'Tuition bill', 'Daycare bill', 'Car bill']
    expect(changed(labels)).toEqual([])
  })

  it("stays after a known shop's name, the first word of a longer one, or AT&T", () => {
    const shops = knownShops(['Xcel Energy', 'AT&T', 'Target', 'Ross'])
    const labels = ['Xcel bill', 'Xcel Energy bill', 'AT&T bill', 'Target bill']
    expect(shownWith(labels, labels, shops)).toEqual(labels)
    // A shop named like a person vouches for nothing.
    expect(shownWith(['Ross bill'], ['Ross bill'], shops)).toEqual(['someone someone'])
  })
})

describe('a lone word name', () => {
  it('is someone beside a person cue, as before', () => {
    expect(
      pairs(['Venmo Bill', "Bill's", 'Mom & Bill', 'Bill and June', 'Tutor Bill due']),
    ).toEqual([
      ['Venmo Bill', 'Venmo someone'],
      ["Bill's", "someone's"],
      ['Mom & Bill', 'Mom & someone'],
      ['Bill and June', 'someone and someone'],
      ['Tutor Bill due', 'Tutor someone due'],
    ])
    expect(pairs(['Pay Bill back', 'Pay back Bill', 'Bill tuition'])).toEqual([
      ['Pay Bill back', 'Pay someone back'],
      ['Pay back Bill', 'Pay back someone'],
      ['Bill tuition', 'someone tuition'],
    ])
  })

  it('is someone with only emoji, numbers or marks around it, but a date stays', () => {
    expect(pairs(['🎂 June', 'Bill🎁', 'Bill #2', 'Bill 15'])).toEqual([
      ['🎂 June', '🎂 someone'],
      ['Bill🎁', 'someone🎁'],
      ['Bill #2', 'someone #2'],
      ['Bill 15', 'someone 15'],
    ])
    expect(changed(['June 15', '15 June', '1st of June', 'Bill', 'June'])).toEqual([])
  })
})

describe("meansTheWord's shop branch", () => {
  // As ownerText.ts asks: a known shop's name, never one named like a person (Ross).
  const shop = (written: string) => written.toLowerCase() === 'target'

  it('takes "Bill" after a shop as the word, and after a shop named like a person as a name', () => {
    expect(meansTheWord('Target bill', ['Target', 'bill'], 1, shop)).toBe(true)
    expect(meansTheWord('Ross bill', ['Ross', 'bill'], 1, shop)).toBe(false)
  })
})
