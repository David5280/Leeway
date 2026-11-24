// Roles in the owner's labels (domain/chat/personCues.ts): a role names the
// person right after it, but what it is paid for, a date or a clinician's
// bill stays the word; a role right after a name may be a surname; and a
// shop's word that is also a payment app's vouches for no "Bill". Read
// through every step Chat takes. Every name is made up.

import { describe, expect, it } from 'vitest'
import { knownShops } from '../src/domain/knownShops.js'
import { pairs, shownWith } from './labelsShown.js'

/** The labels of a list that a tool's output does not show as written, which should be none. */
const changed = (labels: readonly string[]) =>
  pairs(labels).filter(([label, reads]) => label !== reads)

describe('a role right after a hidden word', () => {
  it('is hidden too, since it may be the surname', () => {
    expect(pairs(['Bill Coach', 'Ignatius Pastor', 'Jane Mentor'])).toEqual([
      ['Bill Coach', 'someone someone'],
      ['Ignatius Pastor', 'someone someone'],
      ['Jane Mentor', 'someone someone'],
    ])
  })

  it('stays when it is an everyday word, or follows no hidden word', () => {
    expect(pairs(['Jane Teacher', 'Ignatius Nanny'])).toEqual([
      ['Jane Teacher', 'someone Teacher'],
      ['Ignatius Nanny', 'someone Nanny'],
    ])
    expect(changed(['Coach', 'Pastor', 'Mentor sessions', 'Gift - Coach'])).toEqual([])
  })
})

describe('the word right after a role', () => {
  it('stays when it is what the role is paid or known for', () => {
    const labels = ['Sitter tip', 'Housekeeper tip', 'Teacher appreciation', 'Nanny cam']
    expect(changed([...labels, 'Coach session', 'Teacher gift', 'Tutor lessons'])).toEqual([])
  })

  it('stays as a month before a day or a year', () => {
    expect(changed(['Tutor April 2027', 'Coach June 15', 'Coach June 15th'])).toEqual([])
  })

  it('is someone otherwise, a month alone or after a payment app included', () => {
    const labels = ['Coach June', 'Tutor April', 'Coach Bill', 'Venmo June 15', 'Sitter Ignatius']
    expect(pairs(labels)).toEqual([
      ['Coach June', 'Coach someone'],
      ['Tutor April', 'Tutor someone'],
      ['Coach Bill', 'Coach someone'],
      ['Venmo June 15', 'Venmo someone 15'],
      ['Sitter Ignatius', 'Sitter someone'],
    ])
  })
})

describe('a doctor, a dentist or a vet', () => {
  it('names the person after them', () => {
    expect(pairs(['Doctor Brown', 'Dentist White', 'Vet Hill', 'Doctor Ignatius'])).toEqual([
      ['Doctor Brown', 'Doctor someone'],
      ['Dentist White', 'Dentist someone'],
      ['Vet Hill', 'Vet someone'],
      ['Doctor Ignatius', 'Doctor someone'],
    ])
  })

  it('keeps their bill, and the words of a visit', () => {
    const labels = ['Doctor bill', 'Dentist bill', 'Vet bill', 'DOCTOR BILL']
    expect(changed([...labels, 'Doctor visits', 'Dentist', 'Vet'])).toEqual([])
    expect(pairs(['Doctor Bill Ostrowski'])).toEqual([
      ['Doctor Bill Ostrowski', 'Doctor someone someone'],
    ])
  })
})

describe("a shop whose name is a payment app's word", () => {
  it('vouches for no "Bill" after it, though its own name stays', () => {
    const shops = knownShops(['Apple', 'Square'])
    const labels = ['Apple Bill', 'Square Bill']
    expect(shownWith(labels, labels, shops)).toEqual(['Apple someone', 'Square someone'])
  })
})
