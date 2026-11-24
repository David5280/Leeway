// Every theme's tab colors, light and dark: each reads at 4.5:1 on a card,
// tinted or not, the four stay apart for every kind of color blindness, and
// the text a tinted card holds still reads on it. The tint is read from
// styles/places.css itself, so this checks what is drawn.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { closestPair } from './colorVision'
import { contrastRatio, mixRgb, parseHex } from './contrast'
import { PLACE_IDS, PLACES, placeVariable, placeVariables, TAB_PLACES } from './places'
import { THEMES, type ThemeId } from './theme'

const SETS = (Object.keys(THEMES) as ThemeId[]).flatMap((theme) =>
  (['light', 'dark'] as const).map((mode) => ({
    theme,
    mode,
    name: `${theme} ${mode}`,
    tokens: THEMES[theme][mode],
    places: PLACES[theme][mode],
  })),
)

const CSS = readFileSync(resolve(__dirname, '../styles/places.css'), 'utf8')

/** How much of the tab's color a tinted card mixes into a property: 0.08 for "--place-fill". */
function tintShare(property: '--place-fill' | '--place-edge'): number {
  const mix = new RegExp(`${property}: color-mix\\(in srgb, var\\(--place\\) (\\d+)%`).exec(CSS)
  if (!mix) throw new Error(`places.css has no color-mix for ${property}`)
  return Number(mix[1]) / 100
}

const FILL = tintShare('--place-fill')
const EDGE = tintShare('--place-edge')

/** The text colors a tab's tinted card can hold. */
const CARD_TEXT = ['ink', 'muted', 'good', 'warn', 'over'] as const

describe('the tints read from places.css', () => {
  it('stay faint: a tenth of the color or less on the card, under a third on its border', () => {
    expect(FILL).toBeGreaterThanOrEqual(0.05)
    expect(FILL).toBeLessThanOrEqual(0.1)
    expect(EDGE).toBeGreaterThan(FILL)
    expect(EDGE).toBeLessThanOrEqual(0.3)
  })
})

describe.each(SETS)('the $name tab colors', ({ theme, mode, tokens, places }) => {
  const surface = parseHex(tokens.surface)

  it.each(Object.keys(places) as (keyof typeof places)[])(
    'sets %s at 4.5:1 or more on a plain card and on its own tint',
    (place) => {
      const color = parseHex(places[place])
      const tint = mixRgb(color, surface, FILL)
      expect(contrastRatio(color, surface), 'plain').toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(color, tint), 'tinted').toBeGreaterThanOrEqual(4.5)
    },
  )

  it('keeps the four apart for normal eyes and all three kinds of color blindness', () => {
    const closest = closestPair(places)
    expect(
      closest.distance,
      `${closest.pair.join(' and ')}, ${closest.vision}`,
    ).toBeGreaterThanOrEqual(20)
  })

  it('keeps every text color at 4.5:1 or more on each tab’s tinted card', () => {
    for (const [place, hex] of Object.entries(places)) {
      const tint = mixRgb(parseHex(hex), surface, FILL)
      for (const tone of CARD_TEXT) {
        const ratio = contrastRatio(parseHex(tokens[tone]), tint)
        expect(ratio, `${tone} on ${place}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('wears the ink for Home, which reads on its card at 4.5:1 or more', () => {
    const home = placeVariables(theme, mode, tokens.ink)['--place-home']!
    expect(home).toBe(tokens.ink)
    expect(contrastRatio(parseHex(home), surface)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('placeVariables', () => {
  it('names one variable per place, Home first', () => {
    expect(PLACE_IDS.map(placeVariable)).toEqual([
      '--place-home',
      '--place-spend',
      '--place-pay',
      '--place-goal',
      '--place-wealth',
    ])
  })

  it('sets the theme and mode’s four tab colors and the given ink', () => {
    expect(placeVariables('neon', 'dark', '#E8F0FF')).toEqual({
      '--place-home': '#E8F0FF',
      '--place-spend': PLACES.neon.dark.spend,
      '--place-pay': PLACES.neon.dark.pay,
      '--place-goal': PLACES.neon.dark.goal,
      '--place-wealth': PLACES.neon.dark.wealth,
    })
  })

  it('gives light modes darker partners than dark modes', () => {
    for (const theme of Object.keys(PLACES) as ThemeId[]) {
      for (const place of Object.keys(PLACES[theme].light) as (keyof typeof PLACES.neon.light)[]) {
        const white = parseHex('#FFFFFF')
        const light = contrastRatio(parseHex(PLACES[theme].light[place]), white)
        const dark = contrastRatio(parseHex(PLACES[theme].dark[place]), white)
        expect(light, `${theme} ${place}`).toBeGreaterThan(dark)
      }
    }
  })
})

describe('TAB_PLACES', () => {
  it('gives each of the five tabs its own place', () => {
    const places = Object.values(TAB_PLACES)
    expect(new Set(places).size).toBe(5)
    expect([...places].sort()).toEqual([...PLACE_IDS].sort())
  })
})
