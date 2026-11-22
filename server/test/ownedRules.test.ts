// The pure rules for what is entered by hand: each account's everyday kind,
// which amounts may go below zero, and what a loan can be tied to.

import { describe, expect, it } from 'vitest'
import {
  amountProblem,
  canCarryLoan,
  carriesLoan,
  isLoan,
  kindOfItem,
  mayBeNegative,
  type ItemKind,
} from '../src/domain/ownedRules.js'

describe('the everyday kind of a manual account', () => {
  it('reads a home and a car from property, and any other property as other', () => {
    expect(kindOfItem({ type: 'property', subtype: 'home' })).toBe('home')
    expect(kindOfItem({ type: 'property', subtype: 'vehicle' })).toBe('vehicle')
    expect(kindOfItem({ type: 'property', subtype: 'boat' })).toBe('other')
    expect(kindOfItem({ type: 'property', subtype: null })).toBe('other')
  })

  it('reads older entries by their type', () => {
    expect(kindOfItem({ type: 'loan', subtype: null })).toBe('loan')
    expect(kindOfItem({ type: 'credit', subtype: null })).toBe('card')
    expect(kindOfItem({ type: 'depository', subtype: 'checking' })).toBe('cash')
    expect(kindOfItem({ type: 'investment', subtype: null })).toBe('investment')
    expect(kindOfItem({ type: 'other', subtype: null })).toBe('other')
  })
})

describe('what a loan can be tied to', () => {
  it('is a loan by its kind, never a card', () => {
    expect(isLoan({ kind: 'loan' })).toBe(true)
    expect(isLoan({ kind: 'credit_card' })).toBe(false)
    expect(isLoan({ kind: 'other' })).toBe(false)
  })

  it('goes on a home or a car only', () => {
    expect(canCarryLoan({ type: 'property', subtype: 'home' })).toBe(true)
    expect(canCarryLoan({ type: 'property', subtype: 'vehicle' })).toBe(true)
    expect(canCarryLoan({ type: 'property', subtype: 'other' })).toBe(false)
    expect(canCarryLoan({ type: 'depository', subtype: 'checking' })).toBe(false)
    expect(canCarryLoan({ type: 'loan', subtype: null })).toBe(false)
    const kinds: ItemKind[] = ['home', 'vehicle', 'other', 'loan', 'cash', 'investment', 'card']
    expect(kinds.filter(carriesLoan)).toEqual(['home', 'vehicle'])
  })
})

describe('amounts below zero', () => {
  const kinds: ItemKind[] = ['home', 'vehicle', 'other', 'loan', 'cash', 'investment', 'card']

  it('are only for cash and cards', () => {
    expect(kinds.filter(mayBeNegative)).toEqual(['cash', 'card'])
  })

  it('say what to enter instead, and zero is always fine', () => {
    for (const kind of kinds) expect(amountProblem(kind, 0)).toBeNull()
    expect(amountProblem('cash', -14_210)).toBeNull()
    expect(amountProblem('card', -1)).toBeNull()
    expect(amountProblem('loan', -1)).toBe(
      "What is still owed can't be below zero. Enter 0 once it is paid off.",
    )
    for (const kind of ['home', 'vehicle', 'other', 'investment'] as const) {
      expect(amountProblem(kind, -1)).toBe("What it is worth can't be below zero.")
    }
  })
})
