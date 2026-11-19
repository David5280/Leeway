// Every theme, light and dark, reads at WCAG AA: text tones on every surface,
// status pills on their tints, and category icons on their tinted circles.

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

/** How styles/design.css tints a category icon's circle and darkens or lightens its glyph. */
const ICON_TINT = 0.16
const ICON_GLYPH = 0.6
/** How a status pill tints its background with its tone, and deepens its text toward the ink. */
const PILL_TINT = 0.14
const PILL_TEXT = 0.8

const categoryColors = [
  ...new Set([...STARTER_CATEGORIES.map((c) => c.color), ...CATEGORY_COLORS.map(([, c]) => c)]),
]

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
