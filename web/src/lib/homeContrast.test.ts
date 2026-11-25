// Home's own card colors read at WCAG AA in every theme and mode, with every
// accent the owner can pick: each text color on Leeway's card, where the
// accent lights the corner its label sits in, and the words on Heads up's
// amber and red tints, whose links take the ink there (styles.css), and on
// the note shown while editing. The tab cards wear their tab's tint, checked
// in lib/places.test.ts.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, mixRgb, parseHex } from './contrast'
import { ACCENTS, THEMES } from './theme'

/** Every text color Leeway's card may draw (styles/tokens.css). */
const HERO_TEXT = ['ink', 'muted', 'good', 'warn', 'over', 'accent'] as const
/** The text colors on Heads up's tints: its words, its small labels, and its links in the ink. */
const TINTED_TEXT = ['ink', 'muted'] as const

const STYLES = readFileSync(resolve(__dirname, '../styles.css'), 'utf8')

const DEPTH = readFileSync(resolve(__dirname, '../styles/depth.css'), 'utf8')

/**
 * How much accent lights the hero's corner, read from depth.css itself so this
 * checks what is drawn: 0.08 from color-mix(in srgb, var(--accent) 8%, ...).
 */
function heroLight(): number {
  const rule = DEPTH.split(/\n\.card\.hero \{/)[1]?.split('}')[0] ?? ''
  const percent = /color-mix\(in srgb, var\(--accent\) (\d+)%, transparent\)/.exec(rule)?.[1]
  if (!percent) throw new Error('depth.css has no accent light on .card.hero')
  return Number(percent) / 100
}

/** Each theme and mode, once for its own accent and once for each named accent. */
const LOOKS = Object.entries(THEMES).flatMap(([id, theme]) =>
  (['light', 'dark'] as const).flatMap((mode) =>
    [
      { accentName: 'its own', accent: theme[mode].accent },
      ...Object.values(ACCENTS).map((named) => ({ accentName: named.name, accent: named[mode] })),
    ].map(({ accentName, accent }) => ({
      name: `${id} ${mode} with ${accentName} accent`,
      tokens: { ...theme[mode], accent },
    })),
  ),
)

/** How much accent tints a soft card, such as the note shown while editing (styles.css). */
function softTint(): number {
  const percent = /--accent-soft: color-mix\(in srgb, var\(--accent\) (\d+)%/.exec(STYLES)?.[1]
  if (!percent) throw new Error('styles.css has no --accent-soft mix')
  return Number(percent) / 100
}

/** Text colors below 4.5:1 on a background, as "tone 4.21", for a readable failure. */
function tooFaint(
  text: readonly string[],
  tokens: Record<string, string>,
  background: ReturnType<typeof parseHex>,
) {
  return text
    .map((tone) => [tone, contrastRatio(parseHex(tokens[tone]!), background)] as const)
    .filter(([, ratio]) => ratio < 4.5)
    .map(([tone, ratio]) => `${tone} ${ratio.toFixed(2)}`)
}

describe("the hero's accent light", () => {
  it('stays faint: a tenth of the accent or less', () => {
    expect(heroLight()).toBeGreaterThan(0)
    expect(heroLight()).toBeLessThanOrEqual(0.1)
  })
})

describe("Heads up's links", () => {
  it('take the ink on the amber and red tints, underlined to still read as links', () => {
    const rule = STYLES.split(/\n\.card\.over-card \.linkbtn \{/)[1]?.split('}')[0] ?? ''
    expect(STYLES).toContain('.card.warn-card .linkbtn,\n.card.over-card .linkbtn {')
    expect(rule).toContain('color: var(--ink);')
    expect(rule).toContain('text-decoration: underline;')
  })
})

describe.each(LOOKS)('Home in $name', ({ tokens }) => {
  it("keeps every text color at 4.5:1 or more on Leeway's lit corner", () => {
    const corner = mixRgb(parseHex(tokens.accent), parseHex(tokens.surface), heroLight())
    expect(tooFaint(HERO_TEXT, tokens, corner)).toEqual([])
  })

  it('keeps the words of the note shown while editing at 4.5:1 or more on its tint', () => {
    const soft = mixRgb(parseHex(tokens.accent), parseHex(tokens.surface), softTint())
    expect(tooFaint(['ink'], tokens, soft)).toEqual([])
  })

  it("keeps every text color at 4.5:1 or more on Heads up's amber and red tints", () => {
    expect(tooFaint(TINTED_TEXT, tokens, parseHex(tokens['warn-soft']))).toEqual([])
    expect(tooFaint(TINTED_TEXT, tokens, parseHex(tokens['over-soft']))).toEqual([])
  })
})
