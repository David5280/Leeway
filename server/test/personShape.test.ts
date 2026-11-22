// Whether a merchant name has a person's shape, or names a clinician, so Chat
// labels it (modelLabels.ts), and how a bank line is read as it shows.
// Every name is made up.

import { describe, expect, it } from 'vitest'
import { isBusinessWord } from '../src/domain/businessWords.js'
import { hasAPersonsShape, namesAClinician } from '../src/domain/personShape.js'
import { plainCharacter, plainLetters } from '../src/domain/plainLetters.js'

describe("a person's shape", () => {
  it('is two name words, or two around a middle initial', () => {
    for (const name of [
      'Odalys Larkspur',
      'SERAPHINA OKONKWO',
      'Jane Q. Doe',
      "Mary-Kate O'Neil",
    ]) {
      expect([name, hasAPersonsShape(name)]).toEqual([name, true])
    }
  })

  it('is never one word, three, an everyday or business word, a possessive or a code', () => {
    for (const name of [
      'Spotify',
      'Hooked on Colfax',
      'King Soopers',
      'Taco Bell',
      "Joe's Pizza",
      'Acme Corp',
      'Venmo Payment',
      'Jane D0e',
      'Jane Q Doe Smith',
    ]) {
      expect([name, hasAPersonsShape(name)]).toEqual([name, false])
    }
  })
})

describe('a clinician by name', () => {
  it('has a title or credential, or "MD" after a name', () => {
    expect(namesAClinician('DR. ODALYS LARKSPUR')).toBe(true)
    expect(namesAClinician('ODALYS LARKSPUR LCSW')).toBe(true)
    expect(namesAClinician('Jane Doe, Ph.D')).toBe(true)
    expect(namesAClinician('Jane Doe, M.D.')).toBe(true)
    expect(namesAClinician('DREW PHARMACY')).toBe(false)
    expect(namesAClinician('CVS PHARMACY ANNAPOLIS MD')).toBe(false)
  })
})

describe('business words', () => {
  it('are found in any case', () => {
    expect(isBusinessWord('Insurance')).toBe(true)
    expect(isBusinessWord('CLEANER')).toBe(true)
    expect(isBusinessWord('Larkspur')).toBe(false)
  })
})

describe('a line read as it shows', () => {
  it('drops invisible characters and reads look-alike letters as Latin ones', () => {
    expect(plainLetters('Zelle to Jаne Prycewооd')).toBe('Zelle to Jane Prycewood')
    expect(plainLetters('Zelle to Ζoe Mossgiel')).toBe('Zelle to Zoe Mossgiel')
    expect(plainLetters('Tam­sin Pen​hallow')).toBe('Tamsin Penhallow')
    // Accents stay on their letters, and plain text comes back as it was.
    expect(plainLetters('Zoë Núñez​')).toBe('Zoë Núñez')
    expect(plainLetters('KING SOOPERS')).toBe('KING SOOPERS')
  })

  it('reads one character at a time, accents split off', () => {
    expect(plainCharacter('‍')).toBe('')
    expect(plainCharacter('Ј')).toBe('J')
    expect(plainCharacter('é')).toBe('é')
  })
})
