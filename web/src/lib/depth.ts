// Depth tokens: what makes a theme read as layered rather than flat. Each
// theme and mode gets a soft glow behind the page, a card sheen, a raised
// surface for things nested in a card, and two shadow stacks. themeVariables
// (lib/theme.ts) sets them on the page beside the colors, as CSS variables
// of the same names, and styles/depth.css builds the surfaces from them.
//
// The layers, bottom to top:
//   --bg (surface 0)       the page, lit by --glow and the accent's glow
//   --surface (surface 1)  every card, lifted by --elev-1 and its --hi edge
//   --raised (surface 2)   a tile or chip nested in a card
//   --elev-2               sheets, menus and a screen's one hero card

import type { ThemeId } from './theme'

export type Mode = 'light' | 'dark'

export type DepthTokens = Record<
  /** A surface one step above a card, for tiles nested in one. A hex color. */
  | 'raised'
  /** The second, quieter light behind the page, in a hue the theme pairs with its accent. */
  | 'glow'
  /** How strongly the accent lights the top of the page, as a CSS percentage. */
  | 'glow-accent'
  /** A faint light wash over the top of every card. */
  | 'sheen'
  /** The thin highlight along a card's top edge, as an inset shadow. */
  | 'hi'
  /** A card's shadow: a tight contact shadow under a wide soft one. */
  | 'elev-1'
  /** The hero's, a sheet's and a menu's shadow: one step further up. */
  | 'elev-2',
  string
>

/** Light modes share their shadows: soft and cool, since a light page shows every edge. */
const LIGHT_ELEVATION = {
  sheen: 'rgba(255, 255, 255, 0)',
  hi: 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
  'elev-1':
    '0 1px 2px rgba(16, 24, 40, 0.06), 0 4px 10px -2px rgba(16, 24, 40, 0.05), 0 16px 32px -12px rgba(16, 24, 40, 0.12)',
  'elev-2':
    '0 2px 6px rgba(16, 24, 40, 0.08), 0 12px 24px -6px rgba(16, 24, 40, 0.1), 0 32px 64px -20px rgba(16, 24, 40, 0.24)',
} as const

/** Dark modes need darker, wider shadows to read as depth, and a faint top light. */
const DARK_ELEVATION = {
  sheen: 'rgba(255, 255, 255, 0.035)',
  hi: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
  'elev-1':
    '0 1px 2px rgba(0, 0, 0, 0.5), 0 6px 14px -4px rgba(0, 0, 0, 0.45), 0 22px 44px -18px rgba(0, 0, 0, 0.7)',
  'elev-2':
    '0 2px 8px rgba(0, 0, 0, 0.5), 0 16px 32px -8px rgba(0, 0, 0, 0.55), 0 40px 80px -24px rgba(0, 0, 0, 0.8)',
} as const

export const DEPTH: Record<ThemeId, Record<Mode, DepthTokens>> = {
  // Harbor: sea and sky, a blue accent with a green-teal second light.
  harbor: {
    light: {
      ...LIGHT_ELEVATION,
      raised: '#F7F8F4',
      glow: 'rgba(27, 122, 71, 0.10)',
      'glow-accent': '12%',
    },
    dark: {
      ...DARK_ELEVATION,
      raised: '#1B242D',
      glow: 'rgba(45, 212, 191, 0.10)',
      'glow-accent': '16%',
    },
  },
  // Night: quiet, a blue accent with a faint violet second light.
  night: {
    light: {
      ...LIGHT_ELEVATION,
      raised: '#F8F9FB',
      glow: 'rgba(127, 112, 224, 0.10)',
      'glow-accent': '12%',
    },
    dark: {
      ...DARK_ELEVATION,
      raised: '#1C2026',
      glow: 'rgba(127, 112, 224, 0.12)',
      'glow-accent': '16%',
    },
  },
  // Neon: high contrast, so cards keep a hairline ring and gain a halo in the
  // accent (var(--accent), so a custom accent recolours it too).
  neon: {
    light: {
      ...LIGHT_ELEVATION,
      raised: '#F9F9FD',
      glow: 'rgba(194, 24, 91, 0.08)',
      'glow-accent': '12%',
      'elev-1': `0 0 0 1px #DCDDEE, ${LIGHT_ELEVATION['elev-1']}`,
    },
    dark: {
      ...DARK_ELEVATION,
      raised: '#171729',
      glow: 'rgba(255, 77, 122, 0.14)',
      'glow-accent': '18%',
      sheen: 'color-mix(in srgb, var(--accent) 3%, transparent)',
      hi: 'inset 0 1px 0 color-mix(in srgb, var(--accent) 14%, transparent)',
      'elev-1': `0 0 0 1px #25274B, 0 0 28px -10px color-mix(in srgb, var(--accent) 28%, transparent), ${DARK_ELEVATION['elev-1']}`,
      'elev-2': `0 0 0 1px #2E3160, 0 0 44px -12px color-mix(in srgb, var(--accent) 36%, transparent), ${DARK_ELEVATION['elev-2']}`,
    },
  },
}
