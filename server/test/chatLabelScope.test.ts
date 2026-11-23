// Where Chat hides a word of an owner's label that could be a name: within
// that label alone, wherever it is written, never in Leeway's own words
// around it; and what else a tool's output keeps or loses beside it (the
// owner's notes, a shop's name, an account mask). Every name is made up.

import { describe, expect, it } from 'vitest'
import { chatToolText } from '../src/chat/toolOutput.js'
import { NO_PEOPLE, type PaymentPeople } from '../src/domain/chat/people.js'
import { knownShops } from '../src/domain/knownShops.js'

/** What Chat hides, with only what a case sets. */
const hiding = (fields: Partial<PaymentPeople>): PaymentPeople => ({ ...NO_PEOPLE, ...fields })

/** The output as the model reads it, parsed back. */
const sent = (result: unknown, people: PaymentPeople = NO_PEOPLE): unknown =>
  JSON.parse(chatToolText(result, people))

describe("a word of the owner's label that could be a name", () => {
  const people = hiding({
    labels: [
      { label: "Grace's college fund", words: ['Grace'] },
      { label: 'Mark & Will', words: ['Mark'] },
      { label: 'Joint w/ Grace', words: ['Grace'] },
    ],
  })

  it('goes within the label, wherever it is written, in any case', () => {
    const result = {
      goals: [{ name: "Grace's college fund" }, { name: "GRACE'S COLLEGE FUND" }],
      accounts: [{ displayName: 'Joint w/ Grace' }],
      message: "Grace's college fund is 40% there. Joint w/ Grace is below zero.",
      category: 'Mark & Will',
    }
    expect(sent(result, people)).toEqual({
      goals: [{ name: "someone's college fund" }, { name: "someone's college fund" }],
      accounts: [{ displayName: 'Joint w/ someone' }],
      message: "someone's college fund is 40% there. Joint w/ someone is below zero.",
      category: 'someone & Will',
    })
  })

  it("leaves Leeway's own words around it whole", () => {
    const words = [
      'Will I make it to payday?',
      'Price went up',
      'Mark it as one first',
      'A grace period of 21 days',
    ]
    expect(sent({ words }, people)).toEqual({ words })
  })

  it("goes though it starts a shop, and keeps the shop's whole name", () => {
    const labels = hiding({
      labels: [
        { label: "Ruby's Savings", words: ['Ruby'] },
        { label: "Trader Joe's with Joe", words: ['Joe'] },
      ],
      shops: knownShops(['Ruby Tuesday', "Trader Joe's"]),
    })
    const result = { a: "Ruby's Savings", b: 'Ruby Tuesday', c: "Trader Joe's with Joe" }
    expect(sent(result, labels)).toEqual({
      a: "someone's Savings",
      b: 'Ruby Tuesday',
      c: "Trader Joe's with someone",
    })
  })
})

describe("a label of one word that is a word of a shop's name", () => {
  it("goes alone, but leaves the shop's whole name", () => {
    const people = hiding({
      labels: [{ label: 'Max', words: ['Max'] }],
      shops: knownShops(['HBO Max']),
    })
    expect(
      sent({ category: 'Max', merchant: 'HBO Max', text: 'Max is over budget' }, people),
    ).toEqual({ category: 'someone', merchant: 'HBO Max', text: 'someone is over budget' })
  })
})

describe("the owner's note on a transaction", () => {
  it('is never sent, on a labelled row or one shown by name', () => {
    const rows = new Map([['z', { label: 'Zelle payment (sent)', kind: 'app' as const }]])
    const result = [
      { id: 'z', date: '2026-11-15', displayName: 'To Jane Doe', amountCents: 9, note: 'Jack' },
      { id: 'c', date: '2026-11-15', displayName: 'Costco', amountCents: 9, note: 'with Jack' },
    ]
    expect(sent(result, hiding({ rows }))).toEqual([
      { id: 'z', date: '2026-11-15', displayName: 'Zelle payment (sent)', amountCents: 9 },
      { id: 'c', date: '2026-11-15', displayName: 'Costco', amountCents: 9 },
    ])
  })

  it("is not Leeway's own note on a plan or a figure, which is sent", () => {
    const result = { plan: { note: 'Returns are not promised.' }, spendNow: { note: 'Tight.' } }
    expect(sent(result)).toEqual(result)
  })
})

describe('an account mask', () => {
  it("goes inside a shop's name that is kept whole", () => {
    const people = hiding({
      loneNames: ['Max'],
      masks: ['4417'],
      shops: knownShops(['Studio 4417 Max']),
    })
    expect(sent({ merchant: 'Studio 4417 Max', other: 'Max' }, people)).toEqual({
      merchant: 'Studio •••• Max',
      other: 'someone',
    })
  })
})
