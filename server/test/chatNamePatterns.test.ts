// How a hidden name is found in text however it is written: joined, in any
// case, accents aside, through invisible and look-alike characters, while
// the rest of the text stays as written. Every name is made up.

import { describe, expect, it } from 'vitest'
import {
  fullNamePattern,
  loneNamePattern,
  replacedIn,
  type Replacement,
} from '../src/chat/namePatterns.js'

/** Replaces each name with "someone", full names first, then words alone as written. */
function hidden(text: string, names: string[], lone: string[] = []): string {
  const replacements: Replacement[] = [
    ...names.map((name) => ({ pattern: fullNamePattern(name), with: 'someone' })),
    ...lone.map((word) => ({ pattern: loneNamePattern(word), with: 'someone' })),
  ]
  return replacedIn(text, replacements)
}

describe('a full name', () => {
  it('is found however its words are joined, or not joined at all', () => {
    for (const text of [
      'JANE_DOE',
      'jane-doe',
      'Jane.Doe',
      'Jane  Doe',
      'JaneDoe',
      'Jane/Doe',
      'Jane, Doe',
    ]) {
      expect([text, hidden(text, ['Jane Doe'])]).toEqual([text, 'someone'])
    }
  })

  it('is found as a whole word only, a digit beside it aside', () => {
    expect(hidden('Janet Doe, Jane Doers, Jane Doe2', ['Jane Doe'])).toBe(
      'Janet Doe, Jane Doers, someone2',
    )
  })

  it('is found accents aside, with symbols in it, behind a newline or a quote', () => {
    expect(hidden('From Zoë (Zo) Ruiz, ZoëRuiz', ['Zoë (Zo) Ruiz'])).toBe('From someone, ZoëRuiz')
    expect(hidden('NUNEZ JOSE and José Núñez', ['Jose Nunez', 'Nunez Jose'])).toBe(
      'someone and someone',
    )
    expect(hidden('Paid\nJane Doe,\tthen "Jane\nDoe"', ['Jane Doe'])).toBe(
      'Paid\nsomeone,\tthen "someone"',
    )
  })

  it('is found through invisible characters, keeping the rest as written', () => {
    const cases: [string, string][] = [
      ['Jane​Doe', 'someone'],
      ['Ja­ne Doe', 'someone'],
      ['Jane͏Doe', 'someone'],
      ['JaneﾠDoe', 'someone'],
      ['JaneㅤDoe', 'someone'],
      ['‎Jane⁠ Doe‏ paid', '‎someone‏ paid'],
      ['Café for Jane Doe', 'Café for someone'],
    ]
    for (const [text, expected] of cases) expect(hidden(text, ['Jane Doe'])).toBe(expected)
  })

  it('is found in fullwidth, styled or look-alike letters', () => {
    const cases: [string, string][] = [
      ['2² to Ｊａｎｅ Doe, ＃1', '2² to someone, ＃1'],
      ['𝐉𝐚𝐧𝐞 𝐃𝐨𝐞', 'someone'],
      ['Јane Doe', 'someone'],
      ['Jаne Dοe', 'someone'],
    ]
    for (const [text, expected] of cases) expect(hidden(text, ['Jane Doe'])).toBe(expected)
  })
})

describe('a word of a name alone', () => {
  it('is found as a name is written, with a capital or in capitals, accents aside', () => {
    expect(hidden('José, JOSE, jose and Josefina', [], ['José'])).toBe(
      'someone, someone, jose and Josefina',
    )
    expect(hidden('MARÍA and maría', [], ['MARÍA'])).toBe('someone and maría')
  })

  it('never overlaps a full name found first', () => {
    expect(hidden("JANE DOE's; Doe, Jane", ['Jane Doe', 'Doe Jane'], ['Jane', 'Doe'])).toBe(
      "someone's; someone",
    )
  })
})
