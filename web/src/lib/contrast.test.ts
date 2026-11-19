// Every theme, light and dark, reads at WCAG AA: text tones on every surface,
// status pills on their tints, and category icons on their tinted circles.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STARTER_CATEGORIES } from '../../../server/src/domain/starters'
import { contrastRatio, mixRgb, parseHex } from './contrast'
import { CATEGORY_COLORS, THEMES } from './theme'

const MODES = Object.entries(THEMES).flatMap(([id, theme]) =>
  (['light', 'dark'] as const).map((mode) => ({ name: `${id} ${mode}`, tokens: theme[mode] })),
)

/** Text tones and the surfaces they sit on (styles/tokens.css). */
const TEXT = ['ink', 'muted', 'good', 'over', 'warn', 'accent'] as const
const SURFACES = ['bg', 'surface', 'surface-2'] as const

/** The stylesheet that draws pills and category icons, read as text. */
const DESIGN_CSS = readFileSync(resolve(__dirname, '../styles/design.css'), 'utf8')

/**
 * How much of its tone a rule in design.css mixes into a property, read from
 * the stylesheet itself so this checks what is drawn: 0.14 for ".pill"
 * "background", from color-mix(in srgb, var(--t) 14%, var(--surface)).
 */
function toneShare(selector: string, property: string): number {
  const rule = DESIGN_CSS.split(`\n${selector} {`)[1]?.split('}')[0] ?? ''
  const mix = new RegExp(`\\n\\s*${property}: color-mix\\(in srgb, var\\(--\\w+\\) (\\d+)%`)
  const percent = mix.exec(rule)?.[1]
  if (!percent) throw new Error(`design.css has no color-mix for ${selector} ${property}`)
  return Number(percent) / 100
}

/** How a category icon tints its circle and darkens or lightens its glyph. */
const ICON_TINT = toneShare('.icon-badge', 'background')
const ICON_GLYPH = toneShare('.icon-badge', 'color')
/** How a status pill tints its background with its tone, and deepens its text toward the ink. */
const PILL_TINT = toneShare('.pill', 'background')
const PILL_TEXT = toneShare('.pill', 'color')

const categoryColors = [
  ...new Set([...STARTER_CATEGORIES.map((c) => c.color), ...CATEGORY_COLORS.map(([, c]) => c)]),
]

describe('the mixes read from design.css', () => {
  it('are shares of the tone, between none and all of it', () => {
    for (const share of [PILL_TINT, PILL_TEXT, ICON_TINT, ICON_GLYPH]) {
      expect(share).toBeGreaterThan(0)
      expect(share).toBeLessThan(1)
    }
    // Two digits are read whole: the pill's background takes 14%, not 1%.
    expect(PILL_TINT).toBeGreaterThan(0.1)
  })

  it('says so plainly when a rule is missing', () => {
    expect(() => toneShare('.nowhere', 'color')).toThrow('design.css has no color-mix')
  })
})

describe.each(MODES)('the $name theme', ({ tokens }) => {
  it.each(TEXT)('sets %s text at 4.5:1 or more on every surface', (tone) => {
    for (const surface of SURFACES) {
      const ratio = contrastRatio(parseHex(tokens[tone]), parseHex(tokens[surface]))
      expect(ratio, `${tone} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['good', 'warn', 'over', 'accent'] as const)(
    'sets a %s pill’s text at 4.5:1 or more on its own tint',
    (tone) => {
      const tint = mixRgb(parseHex(tokens[tone]), parseHex(tokens.surface), PILL_TINT)
      const text = mixRgb(parseHex(tokens[tone]), parseHex(tokens.ink), PILL_TEXT)
      expect(contrastRatio(text, tint)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('draws every category icon at 3:1 or more on its tinted circle', () => {
    const surface = parseHex(tokens.surface)
    const ink = parseHex(tokens.ink)
    for (const color of categoryColors) {
      const circle = mixRgb(parseHex(color), surface, ICON_TINT)
      const glyph = mixRgb(parseHex(color), ink, ICON_GLYPH)
      expect(contrastRatio(glyph, circle), color).toBeGreaterThanOrEqual(3)
    }
  })
})
