// Whether a merchant name has a person's shape, or names a clinician, so Chat
// labels it (modelLabels.ts), and how a bank line is read as it shows.
// Every name is made up.

import { describe, expect, it } from 'vitest'
import { isBusinessWord } from '../src/domain/businessWords.js'
import {
  hasAPersonsShape,
  holdsAPersonsName,
  isCredential,
  namesAClinician,
} from '../src/domain/personShape.js'
import { plainCharacter, plainLetters } from '../src/domain/plainLetters.js'

describe("a person's shape", () => {
  it('is two to four name words, or an initial and a surname, initials anywhere', () => {
    for (const name of [
      'Odalys Larkspur',
      'SERAPHINA OKONKWO',
      'Jane Q. Doe',
      "Mary-Kate O'Neil",
      'Siobhan O’Brien',
      'SARAH BETH HOLLOWAY',
      'Juan Carlos Echeverria Lopez',
      'Jane Q Doe Smith',
      'J PEMBERTON',
      'J. R. Pemberton',
      // A name that is also an everyday word is a name word all the same.
      'MARK OSTROWSKI',
      'JANE BROWN',
      'Max Frank',
      'Will Grace',
      'JUNE PARKER',
    ]) {
      expect([name, hasAPersonsShape(name)]).toEqual([name, true])
    }
  })

  it('is never one word, five, an everyday or business word, a possessive or a code', () => {
    for (const name of [
      'Spotify',
      'Hooked on Colfax',
      'King Soopers',
      'Taco Bell',
      "Joe's Pizza",
      'Ben & Jerry’s',
      'Blue Bottle Coffee',
      'Kay Jewelers',
      'Farmers Market',
      'Acme Corp',
      'Venmo Payment',
      'Jane D0e',
      'Anna Beth Cora Dee Eve',
      'J Q',
    ]) {
      expect([name, hasAPersonsShape(name)]).toEqual([name, false])
    }
  })

  it('is found among everyday words and numbers, as pay lines hold it', () => {
    expect(holdsAPersonsName('Direct Dep John Q Public Household Payroll')).toBe(true)
    expect(holdsAPersonsName('Payroll Acme Corp 0042')).toBe(false)
    expect(holdsAPersonsName('State of Colorado Payroll')).toBe(false)
  })

  it('keeps a name that is also a word, and drops credentials, before reading the rest', () => {
    expect(holdsAPersonsName('DIRECT DEP MARK WHITLOCK HOUSEHOLD PAYROLL')).toBe(true)
    expect(holdsAPersonsName('DIRECT DEP BILL WHITLOCK HOUSEHOLD PAYROLL')).toBe(true)
    expect(holdsAPersonsName('JANE DOE, OTR/L')).toBe(true)
    expect(holdsAPersonsName('JANE DOE COUNSELING')).toBe(true)
    expect(holdsAPersonsName('KING SOOPERS PAYROLL')).toBe(false)
    expect(holdsAPersonsName('ACME PHYSICAL THERAPY')).toBe(false)
  })
})

describe('a clinician by name', () => {
  it('has a title or credential, or "MD" after a name', () => {
    expect(namesAClinician('DR. ODALYS LARKSPUR')).toBe(true)
    expect(namesAClinician('ODALYS LARKSPUR LCSW')).toBe(true)
    expect(namesAClinician('Jane Doe, Ph.D')).toBe(true)
    expect(namesAClinician('Jane Doe, M.D.')).toBe(true)
    expect(namesAClinician('CORWIN ASHBY DC')).toBe(true)
    expect(namesAClinician('MARA LINDQVIST NP')).toBe(true)
    expect(namesAClinician('Mara Lindqvist, PA-C')).toBe(true)
    expect(namesAClinician('ASHBY FAMILY CHIRO LMSW')).toBe(true)
    expect(namesAClinician('JANE DOE LAC')).toBe(true)
    expect(namesAClinician('JANE DOE, L.Ac.')).toBe(true)
    expect(namesAClinician('JANE DOE CNM')).toBe(true)
    expect(namesAClinician('JANE DOE, OTR/L')).toBe(true)
    expect(namesAClinician('DREW PHARMACY')).toBe(false)
    expect(namesAClinician('CVS PHARMACY ANNAPOLIS MD')).toBe(false)
    expect(namesAClinician('WASHINGTON DC')).toBe(false)
  })

  it('reads a credential alone, dots aside', () => {
    for (const word of ['LCSW', 'M.D.', 'PA-C', 'dpt', 'Dds', 'OTR/L', 'L.Ac.', 'CNM']) {
      expect([word, isCredential(word)]).toEqual([word, true])
    }
    expect(isCredential('Doe')).toBe(false)
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

  it('reads one character at a time, accents split off and any apostrophe straight', () => {
    expect(plainCharacter('‍')).toBe('')
    for (const apostrophe of ['’', '‘', 'ʼ']) expect(plainCharacter(apostrophe)).toBe("'")
    expect(plainCharacter('Ј')).toBe('J')
    expect(plainCharacter('é')).toBe('é')
  })
})
