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

  it('reads the same with a hyphen or an underscore between words as with a space', () => {
    expect(changed(['Bill-due', 'Electric-Bill', 'Phone-bill', 'Water_bill'])).toEqual([])
    expect(pairs(['Braces_Bill', 'Venmo-June', 'Water bill-June', 'Bill-Smith'])).toEqual([
      ['Braces_Bill', 'Braces_someone'],
      ['Venmo-June', 'Venmo-someone'],
      ['Water bill-June', 'Water bill-someone'],
      ['Bill-Smith', 'someone-someone'],
    ])
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

  it('stays after short capitals with "&", but not after any other "&" name', () => {
    expect(changed(['H&M bill', 'AT&T bill'])).toEqual([])
    expect(pairs(['Mo&Jo bill'])).toEqual([['Mo&Jo bill', 'Mo&someone someone']])
  })
})

describe('"Bill" after a shop\'s word that is not itself shown', () => {
  /** A label as shown beside one known shop. */
  const beside = (shop: string, label: string) => shownWith([label], [label], knownShops([shop]))

  it('is someone after a hidden word, though it starts a known shop', () => {
    expect(beside('Coach Outlet', 'Coach Bill')).toEqual(['Coach someone'])
    expect(beside('Pemberton Plumbing', 'Pemberton Bill')).toEqual(['someone someone'])
    expect(beside('Doe Dental', 'Doe Bill')).toEqual(['someone someone'])
    expect(beside('Kaiser Permanente', 'Kaiser Bill')).toEqual(['someone someone'])
  })

  it('is someone after "for" and a shop\'s word, which "for" hides', () => {
    expect(beside('Pemberton Plumbing', 'Gift for Pemberton Bill')).toEqual([
      'Gift for someone someone',
    ])
    expect(beside('Target', 'Gift for Target Bill')).toEqual(['Gift for someone someone'])
  })

  it('is someone after a role, even one that is a known shop', () => {
    expect(beside('Coach', 'Coach Bill lessons')).toEqual(['Coach someone lessons'])
    expect(beside('Tutor Doctor', 'Tutor Bill')).toEqual(['Tutor someone'])
    expect(pairs(['Nanny Bill', 'Pastor June', 'Neighbor Bill', 'Landlord Bill'])).toEqual([
      ['Nanny Bill', 'Nanny someone'],
      ['Pastor June', 'Pastor someone'],
      ['Neighbor Bill', 'Neighbor someone'],
      ['Landlord Bill', 'Landlord someone'],
    ])
  })

  it('still stays after a shown shop', () => {
    expect(beside('Xcel Energy', 'Xcel bill')).toEqual(['Xcel bill'])
    expect(beside('Xcel Energy', 'Xcel Energy bill')).toEqual(['Xcel Energy bill'])
    expect(beside('Verizon', 'Verizon bill')).toEqual(['Verizon bill'])
    expect(beside('AT&T', 'at&t bill')).toEqual(['at&t bill'])
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

  it('is told where the shop starts, an "&" name at its first word', () => {
    const starts: number[] = []
    const known = (written: string, from: number) => (starts.push(from), written === 'mo&jo')
    expect(meansTheWord('mo&jo bill', ['mo', '&', 'jo', 'bill'], 3, known)).toBe(true)
    expect(meansTheWord('Target bill', ['Target', 'bill'], 1, known)).toBe(false)
    expect(starts).toEqual([0, 0])
  })
})
