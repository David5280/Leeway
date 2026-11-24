// Owner's labels written with invisible characters (an emoji's zero-width
// joiner, a direction isolate, a zero-width space, a soft hyphen) or with
// look-alike letters (Cyrillic, fullwidth): the name in each is found as
// written and hidden, the emoji and the rest kept, read through every step
// Chat takes and end to end through the tools that list labels. Every name
// is made up.

import { describe, expect, it } from 'vitest'
import { chatToolText } from '../src/chat/toolOutput.js'
import { NO_PEOPLE } from '../src/domain/chat/people.js'
import { plainLetters } from '../src/domain/plainLetters.js'
import { useChatProbe } from './chatProbe.js'
import { shown, shownWith } from './labelsShown.js'

// Emoji joined by zero-width joiners, and a name in Cyrillic.
const FAMILY = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'
const CODER = '\u{1F469}\u200d\u{1F4BB}'
const RAINBOW = '\u{1F3F3}\ufe0f\u200d\u{1F308}'
const OLGA = '\u041e\u043b\u044c\u0433\u0430'

// Each label beside how a tool's output shows it when it is the only one.
// The invisible characters are written as escapes so the test shows them.
const CASES: [label: string, reads: string][] = [
  [`${FAMILY} Trip with Ignatius`, `${FAMILY} Trip with someone`],
  [`Ottilie ${CODER} laptop`, `someone ${CODER} laptop`],
  [`${RAINBOW} Trip with Ignatius`, `${RAINBOW} Trip with someone`],
  ['\u2068Ottilie\u2069 braces', '\u2068someone\u2069 braces'],
  ['\u200eOttilie braces', '\u200esomeone braces'],
  ['Ottilie\u200b braces', 'someone\u200b braces'],
  ['Otti\u00adlie braces', 'someone braces'],
  ['Otti\u2060lie braces', 'someone braces'],
  ['Jane\u200bbraces', 'someone'],
  [`${OLGA} braces`, 'someone braces'],
  [`Gift for ${OLGA}`, 'Gift for someone'],
  ['\uff2a\uff41\uff4e\uff45 gift', 'someone gift'],
  ['\u041ettilie braces', 'someone braces'],
  // An accent no letter takes in, so no single character spells it.
  ['Ot\u0301tilie braces', 'someone braces'],
]

// The names in CASES as text reads once folded (plainLetters), in lower case.
const NAMES = ['ignatius', 'ottilie', 'jane', plainLetters(OLGA)]

/** The names a text still shows once folded as names are read, which should be none. */
const namesIn = (text: string) =>
  NAMES.filter((name) => plainLetters(text).toLowerCase().includes(name))

describe('a label with an invisible or look-alike character', () => {
  it('shows without the name, its emoji and the rest as written', () => {
    for (const [label, reads] of CASES) expect([label, shown([label])[0]]).toEqual([label, reads])
  })

  it('is hidden wherever it is written, however its invisible characters fall', () => {
    const texts = ['Paid Otti\u00adlie braces', 'Ottilie\u200bbraces', 'OTTILIE BRACES is due']
    expect(shownWith(['Ottilie braces'], texts)).toEqual([
      'Paid someone braces',
      'someone braces',
      'someone braces is due',
    ])
  })

  it("keeps a clinician's credential, which is no one's name", () => {
    expect(shown(['Therapy LCSW'])).toEqual(['Therapy LCSW'])
  })

  it('reads "someone" whole when one of its words cannot be found as written', () => {
    // A word missed, here one not written in the label at all, never shows the name beside it.
    const people = { ...NO_PEOPLE, labels: [{ label: 'Braces for Ottilie', words: ['Zed'] }] }
    expect(JSON.parse(chatToolText({ goal: 'Braces for Ottilie' }, people))).toEqual({
      goal: 'someone',
    })
  })
})

describe('the tools that list labels', () => {
  const probe = useChatProbe()
  const sql = (text: string, values: unknown[] = []) => probe.ctx.db.query(text, values)

  it('show no name written with invisible or look-alike characters', async () => {
    const labels = CASES.map(([label]) => label)
    const { rows } = await sql(
      `INSERT INTO categories (name, color, kind, position)
       SELECT name, '#000000', 'expense', 90 + n FROM unnest($1::text[]) WITH ORDINALITY AS t(name, n)
       RETURNING id`,
      [labels],
    )
    const category = (rows[0] as { id: string }).id
    await sql(
      `INSERT INTO goals (name, target_cents) SELECT name, 5000 FROM unnest($1::text[]) AS name`,
      [labels],
    )
    await sql(
      `INSERT INTO bills (name, amount_cents, cadence, anchor_date)
       SELECT name, 4000, 'month', '2026-12-01' FROM unnest($1::text[]) AS name`,
      [labels],
    )
    await sql(
      `INSERT INTO rules (field, match_type, pattern, category_id, position)
       SELECT 'description', 'contains', pattern, $2, n FROM unnest($1::text[]) WITH ORDINALITY AS t(pattern, n)`,
      [labels, category],
    )

    for (const tool of ['list_categories', 'list_goals', 'list_rules', 'list_bills']) {
      const sent = await probe.sent(tool)
      expect([tool, namesIn(sent)]).toEqual([tool, []])
      // Labels alike once folded may take one another's invisible characters, so each is
      // compared as it reads.
      const read = plainLetters(sent)
      const missing = CASES.filter(([, reads]) => !read.includes(`"${plainLetters(reads)}"`))
      expect([tool, missing]).toEqual([tool, []])
    }
  }, 30_000)
})
