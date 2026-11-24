// How a hidden name is found in text however it is written: joined, in any
// case, accents aside, through invisible and look-alike characters, while
// the rest of the text stays as written. Every name is made up.

import { describe, expect, it } from 'vitest'
import {
  fullNamePattern,
  isFoundIn,
  loneNamePattern,
  maskPattern,
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

describe('a name or label written with invisible or look-alike characters itself', () => {
  it('is found as written, its emoji and invisible characters included', () => {
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'
    expect(hidden(`${family} Trip, then trip`, [`${family} Trip`])).toBe('someone, then trip')
    expect(hidden('Ottilie braces', ['\u2068Ottilie\u2069 braces'])).toBe('someone')
    expect(hidden('\u2068Ottilie\u2069 braces', ['Ottilie braces'])).toBe('\u2068someone')
    expect(hidden('Ottilie braces', ['Otti\u00adlie\u200b braces'])).toBe('someone')
  })

  it('is found through look-alike letters, either way round', () => {
    expect(hidden('Jane gift', ['\uff2a\uff41\uff4e\uff45 gift'])).toBe('someone')
    expect(hidden('\u041ettilie and Ottilie', [], ['Ottilie'])).toBe('someone and someone')
    expect(hidden('Ottilie and \u041ettilie', [], ['\u041ettilie'])).toBe('someone and someone')
    const olga = '\u041e\u043b\u044c\u0433\u0430'
    expect(hidden(`Gift for ${olga}`, [], [olga])).toBe('Gift for someone')
  })

  it('stays a whole word beside an invisible character, which goes with it inside one', () => {
    expect(hidden('Jane\u200bbraces', [], ['Jane'])).toBe('someone\u200bbraces')
    expect(hidden('Otti\u00adlie braces', [], ['Ottilie'])).toBe('someone braces')
  })

  it('matches nothing when it is nothing but invisible characters', () => {
    expect(hidden('Jane Doe', ['\u200b\u2068'])).toBe('Jane Doe')
    expect(isFoundIn('Jane Doe', fullNamePattern('\u200b'))).toBe(false)
    expect(isFoundIn('Jane\u200bDoe', fullNamePattern('Jane Doe'))).toBe(true)
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

  it("takes a name's plural or possessive and a hyphen inside it with it", () => {
    expect(
      hidden("the Prycewoods' cabin, Prycewood's dog", ['Jane Prycewood'], ['Prycewood']),
    ).toBe("the someone' cabin, someone's dog")
    expect(hidden('Bright-water and BRIGHTWATERS', [], ['Brightwater'])).toBe('someone and someone')
    expect(hidden('Ysolde Bright-waters', ['Ysolde Brightwater'])).toBe('someone')
  })
})

describe('a name with an apostrophe or hyphen', () => {
  it('is found whichever apostrophe is written, in the name or the text', () => {
    // A curly apostrophe in the name, a straight one in the text, and the other way round.
    expect(hidden("Siobhan O'Brien's gift", ['SIOBHAN O’BRIEN'])).toBe("someone's gift")
    expect(hidden('Seamus O’Donnell', ["SEAMUS O'DONNELL"])).toBe('someone')
    expect(hidden('O‘Donnell and OʼDONNELL', [], ["O'Donnell"])).toBe('someone and someone')
  })

  it('is found with its hyphen written as a space, a hyphen or nothing', () => {
    const reversed = ['Núñez-García José']
    expect(hidden('NUNEZ GARCIA JOSE', reversed)).toBe('someone')
    expect(hidden('Mary Kate, MaryKate, Mary-Kate', [], ['Mary-Kate'])).toBe(
      'someone, someone, someone',
    )
  })
})

describe('an account mask', () => {
  /** The text with a mask hidden. */
  const masked = (text: string, mask: string) =>
    replacedIn(text, [{ pattern: maskPattern(mask), with: '••••' }])

  it('is hidden as a whole number, after dots or a dash too', () => {
    expect(masked('acct 9911, card ...9911, xxxx-9911', '9911')).toBe(
      'acct ••••, card ...••••, xxxx-••••',
    )
    expect(masked('99110 and 19911', '9911')).toBe('99110 and 19911')
  })

  it('is hidden through invisible characters between its digits', () => {
    expect(masked('acct 99\u200b11, card 9\u00ad911', '9911')).toBe('acct ••••, card ••••')
  })

  it("never in a date's year or an amount", () => {
    expect(masked('2026-11-17, 11/2026, 2026-11', '2026')).toBe('2026-11-17, 11/2026, 2026-11')
    expect(masked('$9911.50, 1,9911, 12:9911', '9911')).toBe('$9911.50, 1,9911, 12:9911')
  })
})
