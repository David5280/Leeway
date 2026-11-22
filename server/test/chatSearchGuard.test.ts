// A search that could confirm a hidden name by how many rows it finds is
// refused before it runs. Every name is made up.

import { describe, expect, it } from 'vitest'
import { HIDDEN_SEARCH_MESSAGE, refusedSearch } from '../src/chat/searchGuard.js'
import { NO_PEOPLE, type PaymentPeople } from '../src/domain/chat/people.js'

const people: PaymentPeople = {
  ...NO_PEOPLE,
  hiddenWords: ['prycewood', 'jane', 'bo'],
  hiddenTexts: [
    { text: 'to jane prycewood', label: 'zelle payment (sent)' },
    { text: 'venmo for concert tickets', label: 'venmo payment (sent)' },
  ],
}

const search = (text: unknown, tool = 'list_transactions') =>
  refusedSearch(tool, tool === 'preview_rule' ? { pattern: text } : { search: text }, people)

describe('a search for text', () => {
  it('is refused when it is a hidden name, part of one, or holds one', () => {
    for (const text of ['Prycewood', 'pryce', 'jane prycewood', 'BO', 'Prýcewood']) {
      expect([text, search(text)]).toEqual([text, HIDDEN_SEARCH_MESSAGE])
    }
    expect(search('Jane', 'preview_rule')).toBe(HIDDEN_SEARCH_MESSAGE)
  })

  it('is refused when only what a labelled row hides holds it, its label aside', () => {
    expect(search('concert')).toBe(HIDDEN_SEARCH_MESSAGE)
    expect(search('venmo')).toBeNull()
    expect(search('payment')).toBeNull()
  })

  it('runs when it finds nothing hidden, is short, or is no search at all', () => {
    for (const text of ['starbucks', 'pr', ' ', 42]) expect(search(text)).toBeNull()
    expect(refusedSearch('list_transactions', { limit: 5 }, people)).toBeNull()
    expect(refusedSearch('list_transactions', null, people)).toBeNull()
    expect(refusedSearch('top_merchants', { search: 'jane' }, people)).toBeNull()
  })
})
