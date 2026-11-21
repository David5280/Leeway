import { describe, expect, it } from 'vitest'
import { countedWords, essentialsWords, monthsWord, type EmergencyView } from './emergencyText'

/** An emergency fund view with two savings accounts, neither picked. */
function view(extra: Partial<EmergencyView> = {}): EmergencyView {
  return {
    goalId: 'g1',
    essentials: { cents: 200_000, from: 'spending', categories: ['Rent', 'Groceries'] },
    months: 1,
    targetCents: 200_000,
    savedCents: 50_000,
    next: { months: 3, targetCents: 600_000 },
    accounts: [
      { id: 'a', name: 'Rainy Day', balanceCents: 50_000, counted: true },
      { id: 'b', name: 'Checking', balanceCents: 90_000, counted: false },
    ],
    picked: false,
    ...extra,
  }
}

describe('months', () => {
  it('says one month and many', () => {
    expect(monthsWord(1)).toBe('1 month')
    expect(monthsWord(6)).toBe('6 months')
  })
})

describe('what counts as essential', () => {
  it('names up to three categories, then counts the rest', () => {
    const named = (categories: string[]) =>
      essentialsWords({ cents: 1, from: 'spending', categories })
    expect(named(['Rent'])).toBe('Rent')
    expect(named(['Rent', 'Groceries'])).toBe('Rent and Groceries')
    expect(named(['Rent', 'Groceries', 'Gas'])).toBe('Rent, Groceries and Gas')
    expect(named(['Rent', 'Groceries', 'Gas', 'Insurance', 'Phone'])).toBe(
      'Rent, Groceries, Gas and 2 more',
    )
  })

  it('says bills while spending is too new, and spending when all of it counts', () => {
    expect(essentialsWords({ cents: 1, from: 'bills', categories: null })).toBe('your bills')
    expect(essentialsWords(null)).toBe('your bills')
    expect(essentialsWords({ cents: 1, from: 'spending', categories: null })).toBe('your spending')
    expect(essentialsWords({ cents: 1, from: 'spending', categories: [] })).toBe('your spending')
  })
})

describe('the accounts counted', () => {
  it('says every savings account until some are picked, then names them', () => {
    expect(countedWords(view())).toBe('every savings account')
    const picked = view({
      picked: true,
      accounts: view().accounts.map((account) => ({ ...account, counted: true })),
    })
    expect(countedWords(picked)).toBe('Rainy Day and Checking')
  })

  it('says a savings account will count once there is one', () => {
    expect(countedWords(view({ accounts: [] }))).toBe('your savings accounts, once you have one')
  })
})
