// Place colors: each tab's own color, which only ever says where you are.
// Color has two jobs and never both at once. Numbers wear a status (good,
// warn, over, ink or muted, from lib/theme.ts) and never a place; a place
// colors the active tab, a tab page's card labels, its faint card tints and
// its charts' marks (styles/places.css).
//
// Spending is violet, Payday sky, Goals rose and Wealth aqua. Home holds a
// bit of everything, so it wears the theme's ink. The bright dark-mode colors
// fail on white, so light modes get darker partners, picked so the four stay
// apart for every kind of color blindness and read at 4.5:1 on a card, its
// own tint included (lib/places.test.ts checks every theme and mode).

import type { Mode } from './depth'
import type { ThemeId } from './theme'

/** Where you are: Home and the four tabs with a color of their own. */
export const PLACE_IDS = ['home', 'spend', 'pay', 'goal', 'wealth'] as const
export type PlaceId = (typeof PLACE_IDS)[number]

/** The four tab colors; Home takes the theme's ink instead (placeVariables). */
export type PlaceColors = Record<Exclude<PlaceId, 'home'>, string>

/** Each tab's place, by the tab's name in routes.ts paths (components/shell/tabs.ts). */
export const TAB_PLACES = {
  home: 'home',
  spending: 'spend',
  payday: 'pay',
  goals: 'goal',
  wealth: 'wealth',
} as const satisfies Record<string, PlaceId>

/**
 * Bright enough to read on every dark card (5:1 or more on the darkest
 * pairing, Harbor's), and apart from each other for all three kinds of color
 * blindness, so the three dark themes share them.
 */
const DARK: PlaceColors = {
  spend: '#9980FE',
  pay: '#98BFFE',
  goal: '#C77EA1',
  wealth: '#34EEE5',
}

/**
 * The darker partners for white cards. Lightness keeps them apart where color
 * blindness merges hues: violet and sky differ in lightness for red-green
 * eyes, which see both as blue, and so do rose and aqua; violet and rose do
 * for blue-yellow eyes. So Spending and Wealth sit darker, Payday and Goals
 * lighter. Every light theme's card is white, so they share these too.
 */
const LIGHT: PlaceColors = {
  spend: '#5640B6',
  pay: '#1273AA',
  goal: '#AC4E75',
  wealth: '#05493A',
}

/** The tab colors of every theme, in each of its modes. */
export const PLACES: Record<ThemeId, Record<Mode, PlaceColors>> = {
  harbor: { light: LIGHT, dark: DARK },
  night: { light: LIGHT, dark: DARK },
  neon: { light: LIGHT, dark: DARK },
}

/** The CSS variable a place's color is set in: "--place-spend". */
export function placeVariable(place: PlaceId): string {
  return `--place-${place}`
}

/** The five place variables for a theme and mode, Home's being that mode's `ink`. */
export function placeVariables(theme: ThemeId, mode: Mode, ink: string): Record<string, string> {
  const colors: Record<PlaceId, string> = { home: ink, ...PLACES[theme][mode] }
  return Object.fromEntries(PLACE_IDS.map((place) => [placeVariable(place), colors[place]]))
}
