// Every theme, light and dark, reads at WCAG AA: text tones on every surface
// (the status tones good, warn and over, muted text and the accent among
// them, with good and over apart in lightness), status pills and usual chips
// on their tints, category icons and tile icons on their tinted circles, and
// chart bars on the card, the running period's lighter fill included, with
// money in apart in lightness from money out, plain or red. The tab colors
// have their own checks (lib/places.test.ts).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STARTER_CATEGORIES } from '../../../server/src/domain/starters'
import { RUNNING_FILL_OPACITY } from './chartScale'
import { contrastRatio, mixRgb, parseHex } from './contrast'
import { CATEGORY_COLORS, THEMES } from './theme'

const MODES = Object.entries(THEMES).flatMap(([id, theme]) =>
  (['light', 'dark'] as const).map((mode) => ({ name: `${id} ${mode}`, tokens: theme[mode] })),
)

/** Text tones and the surfaces they sit on (styles/tokens.css). */
const TEXT = ['ink', 'muted', 'good', 'over', 'warn', 'accent'] as const
const SURFACES = ['bg', 'surface', 'surface-2'] as const

/** The stylesheets that draw tinted chips and icons, read as text. */
const STYLES = {
  tokens: readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8'),
  design: readFileSync(resolve(__dirname, '../styles/design.css'), 'utf8'),
  figures: readFileSync(resolve(__dirname, '../styles/figures.css'), 'utf8'),
}

/**
 * How much of its tone a rule mixes into a property, read from the stylesheet
 * itself so this checks what is drawn: 0.14 for ".pill" "background", from
 * color-mix(in srgb, var(--t) 14%, var(--surface)). The rule may be the first
 * of several selectors sharing it (".tile-icon," before ".kind-chip").
 */
function toneShare(selector: string, property: string, sheet: keyof typeof STYLES = 'design') {
  const rule =
    STYLES[sheet].split(new RegExp(`\\n\\${selector}[ ,][^{]*\\{`))[1]?.split('}')[0] ?? ''
  const mix = new RegExp(`\\n\\s*${property}: color-mix\\(in srgb, var\\(--\\w+\\) (\\d+)%`)
  const percent = mix.exec(rule)?.[1]
  if (!percent) throw new Error(`${sheet}.css has no color-mix for ${selector} ${property}`)
  return Number(percent) / 100
}

/** How a category icon tints its circle and darkens or lightens its glyph. */
const ICON_TINT = toneShare('.icon-badge', 'background')
const ICON_GLYPH = toneShare('.icon-badge', 'color')
/** How a status pill tints its background with its tone, and deepens its text toward the ink. */
const PILL_TINT = toneShare('.pill', 'background')
const PILL_TEXT = toneShare('.pill', 'color')
/** The tinted chips and icons of the redesign (figures.css), each a tint and a text mix. */
const TINTED = [
  ['.usual-chip', 'usual chip'],
  ['.drill-usual', "drill-down's usual line"],
  ['.tile-icon', 'tile icon'],
].map(([selector, name]) => ({
  name: name!,
  tint: toneShare(selector!, 'background', 'figures'),
  text: toneShare(selector!, 'color', 'figures'),
}))

/** How much of the muted tone money out keeps as it is darkened (tokens.css --tone-out). */
const OUT_SHARE = (() => {
  const percent = /--tone-out: color-mix\(in srgb, var\(--muted\) (\d+)%, black\)/.exec(
    STYLES.tokens,
  )?.[1]
  if (!percent) throw new Error('tokens.css has no --tone-out mix')
  return Number(percent) / 100
})()

/** How much of the problem red a month that ran short keeps as it is darkened (tokens.css --tone-short). */
const SHORT_SHARE = (() => {
  const percent = /--tone-short: color-mix\(in srgb, var\(--over\) (\d+)%, black\)/.exec(
    STYLES.tokens,
  )?.[1]
  if (!percent) throw new Error('tokens.css has no --tone-short mix')
  return Number(percent) / 100
})()

const categoryColors = [
  ...new Set([...STARTER_CATEGORIES.map((c) => c.color), ...CATEGORY_COLORS.map(([, c]) => c)]),
]

describe('the mixes read from design.css', () => {
  it('are shares of the tone, between none and all of it', () => {
    const tinted = TINTED.flatMap(({ tint, text }) => [tint, text])
    for (const share of [PILL_TINT, PILL_TEXT, ICON_TINT, ICON_GLYPH, ...tinted]) {
      expect(share).toBeGreaterThan(0)
      expect(share).toBeLessThan(1)
    }
    // Two digits are read whole: the pill's background takes 14%, not 1%.
    expect(PILL_TINT).toBeGreaterThan(0.1)
  })

  it('reads how much money out darkens the muted tone', () => {
    expect(OUT_SHARE).toBeGreaterThan(0.5)
    expect(OUT_SHARE).toBeLessThan(1)
  })

  it('reads how much a month that ran short darkens the problem red', () => {
    expect(SHORT_SHARE).toBeGreaterThan(0.5)
    expect(SHORT_SHARE).toBeLessThan(1)
  })

  it('says so plainly when a rule is missing', () => {
    expect(() => toneShare('.nowhere', 'color')).toThrow('design.css has no color-mix')
    expect(() => toneShare('.nowhere', 'color', 'figures')).toThrow('figures.css has no color-mix')
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

  // Usual chips are muted, green or amber; tile icons accent, green or amber.
  it.each(TINTED)('sets a $name in every tone at 4.5:1 or more on its own tint', (chip) => {
    for (const tone of ['muted', 'good', 'warn', 'accent'] as const) {
      const tint = mixRgb(parseHex(tokens[tone]), parseHex(tokens.surface), chip.tint)
      const text = mixRgb(parseHex(tokens[tone]), parseHex(tokens.ink), chip.text)
      expect(contrastRatio(text, tint), tone).toBeGreaterThanOrEqual(4.5)
    }
  })

  // Green and red merge for red-green color blindness, so the good and over
  // tones also differ in lightness (and never show without a sign or a word).
  it('sets the good and over tones apart in lightness, not hue alone', () => {
    expect(contrastRatio(parseHex(tokens.good), parseHex(tokens.over))).toBeGreaterThanOrEqual(1.3)
  })

  it('draws money out apart from money in by lightness, not hue alone, and both at 3:1 on the card', () => {
    const surface = parseHex(tokens.surface)
    const moneyIn = parseHex(tokens.good)
    const moneyOut = mixRgb(parseHex(tokens.muted), parseHex('#000000'), OUT_SHARE)
    expect(contrastRatio(moneyOut, moneyIn)).toBeGreaterThanOrEqual(1.5)
    expect(contrastRatio(moneyIn, surface)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(moneyOut, surface)).toBeGreaterThanOrEqual(3)
  })

  it('draws a month that ran short apart from money in by lightness, and at 3:1 on the card', () => {
    const surface = parseHex(tokens.surface)
    const moneyIn = parseHex(tokens.good)
    const short = mixRgb(parseHex(tokens.over), parseHex('#000000'), SHORT_SHARE)
    expect(contrastRatio(short, moneyIn)).toBeGreaterThanOrEqual(1.5)
    expect(contrastRatio(short, surface)).toBeGreaterThanOrEqual(3)
  })

  it("draws the running period's lighter bars at 3:1 or more on the card, in every bar tone", () => {
    const surface = parseHex(tokens.surface)
    const tones = {
      in: parseHex(tokens.good),
      out: mixRgb(parseHex(tokens.muted), parseHex('#000000'), OUT_SHARE),
      plain: parseHex(tokens.muted),
      over: parseHex(tokens.over),
    }
    for (const [name, tone] of Object.entries(tones)) {
      const fill = mixRgb(tone, surface, RUNNING_FILL_OPACITY)
      expect(contrastRatio(fill, surface), name).toBeGreaterThanOrEqual(3)
    }
  })

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
