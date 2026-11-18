// Themes are sets of color tokens. Every theme has a light and a dark set;
// the rest of the look (accent, font, corners, density) layers on top.

import type { Settings } from '../api/client'

export type Appearance = Settings['appearance']
export type ThemeId = Appearance['theme']
type Mode = 'light' | 'dark'

type Tokens = Record<
  | 'bg'
  | 'surface'
  | 'surface-2'
  | 'ink'
  | 'muted'
  | 'line'
  | 'accent'
  | 'accent-ink'
  | 'good'
  | 'warn'
  | 'warn-fill'
  | 'warn-soft'
  | 'over'
  | 'over-fill'
  | 'over-soft'
  | 'track'
  | 'shadow',
  string
>

const LIGHT_SHADOW = '0 1px 2px rgba(20,23,26,.04),0 10px 30px rgba(20,23,26,.05)'

export const THEMES: Record<
  ThemeId,
  { name: string; description: string; mode: Mode; font: FontId; radius: number } & Record<
    Mode,
    Tokens
  >
> = {
  harbor: {
    name: 'Harbor',
    description: 'Light and calm',
    mode: 'light',
    font: 'geist',
    radius: 16,
    light: {
      bg: '#F3F4EF',
      surface: '#FFFFFF',
      'surface-2': '#ECEEE7',
      ink: '#15171A',
      muted: '#596068',
      line: '#DFE2DA',
      accent: '#1F4FE0',
      'accent-ink': '#FFFFFF',
      good: '#1B7A47',
      warn: '#935400',
      'warn-fill': '#E89B1A',
      'warn-soft': '#FCEFD9',
      over: '#BA3127',
      'over-fill': '#E0483B',
      'over-soft': '#FBE4E1',
      track: '#E9EBE4',
      shadow: LIGHT_SHADOW,
    },
    dark: {
      bg: '#0E1318',
      surface: '#151C23',
      'surface-2': '#1B242D',
      ink: '#E8EDF2',
      muted: '#93A0AD',
      line: '#24303B',
      accent: '#7FA2FF',
      'accent-ink': '#0E1318',
      good: '#5CCF8C',
      warn: '#F2B24A',
      'warn-fill': '#F2B24A',
      'warn-soft': '#2D2413',
      over: '#FF8371',
      'over-fill': '#FF6B57',
      'over-soft': '#341B18',
      track: '#222C36',
      shadow: 'none',
    },
  },
  night: {
    name: 'Night',
    description: 'Dark and quiet',
    mode: 'dark',
    font: 'geist',
    radius: 16,
    light: {
      bg: '#F6F7F9',
      surface: '#FFFFFF',
      'surface-2': '#EEF0F3',
      ink: '#14171B',
      muted: '#5B636D',
      line: '#E0E3E8',
      accent: '#2F54D9',
      'accent-ink': '#FFFFFF',
      good: '#1B7A47',
      warn: '#935400',
      'warn-fill': '#E89B1A',
      'warn-soft': '#FCEFD9',
      over: '#BA3127',
      'over-fill': '#E0483B',
      'over-soft': '#FBE4E1',
      track: '#E8EAEE',
      shadow: LIGHT_SHADOW,
    },
    dark: {
      bg: '#0D0F12',
      surface: '#15181D',
      'surface-2': '#1C2026',
      ink: '#EDEFF2',
      muted: '#9AA1AA',
      line: '#262B32',
      accent: '#86A8FF',
      'accent-ink': '#0D0F12',
      good: '#5CCF8C',
      warn: '#F2B24A',
      'warn-fill': '#F2B24A',
      'warn-soft': '#2D2413',
      over: '#FF8371',
      'over-fill': '#FF6B57',
      'over-soft': '#341B18',
      track: '#232830',
      shadow: 'none',
    },
  },
  neon: {
    name: 'Neon',
    description: 'Dark, high contrast',
    mode: 'dark',
    font: 'space-grotesk',
    radius: 6,
    light: {
      bg: '#F6F6FB',
      surface: '#FFFFFF',
      'surface-2': '#EEEEF7',
      ink: '#0B0B1A',
      muted: '#5A5F80',
      line: '#DCDDEE',
      accent: '#00866F',
      'accent-ink': '#FFFFFF',
      good: '#00866F',
      warn: '#8A6A00',
      'warn-fill': '#E6B800',
      'warn-soft': '#FFF5CC',
      over: '#C2185B',
      'over-fill': '#FF4D7A',
      'over-soft': '#FDE3EC',
      track: '#E6E6F2',
      shadow: '0 0 0 1px #DCDDEE',
    },
    dark: {
      bg: '#08080F',
      surface: '#10101C',
      'surface-2': '#171729',
      ink: '#E8F0FF',
      muted: '#8F96BA',
      line: '#25274B',
      accent: '#00E5C0',
      'accent-ink': '#06060C',
      good: '#00E5C0',
      warn: '#FFD23F',
      'warn-fill': '#FFD23F',
      'warn-soft': '#2A2410',
      over: '#FF5C85',
      'over-fill': '#FF4D7A',
      'over-soft': '#2E1020',
      track: '#1D1E36',
      shadow: '0 0 0 1px #25274B',
    },
  },
}

export const ACCENTS = {
  blue: { name: 'Blue', light: '#1F4FE0', dark: '#86A8FF' },
  teal: { name: 'Teal', light: '#0F766E', dark: '#2DD4BF' },
  violet: { name: 'Violet', light: '#5B3FD1', dark: '#A996FF' },
  orange: { name: 'Orange', light: '#B54708', dark: '#FF9F5A' },
  pink: { name: 'Pink', light: '#B4236B', dark: '#FF7AB8' },
  mint: { name: 'Mint', light: '#047857', dark: '#00E5C0' },
} as const

export type FontId = Exclude<Appearance['font'], 'theme'>

export const FONTS: Record<FontId, { name: string; ui: string; num: string }> = {
  geist: {
    name: 'Geist',
    ui: "'Geist', system-ui, sans-serif",
    num: "'Geist Mono', ui-monospace, monospace",
  },
  'space-grotesk': {
    name: 'Space Grotesk',
    ui: "'Space Grotesk', system-ui, sans-serif",
    num: "'JetBrains Mono', ui-monospace, monospace",
  },
  'ibm-plex': {
    name: 'IBM Plex',
    ui: "'IBM Plex Sans', system-ui, sans-serif",
    num: "'IBM Plex Mono', ui-monospace, monospace",
  },
  system: {
    name: 'System',
    ui: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    num: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
}

export const CORNERS = { round: 16, soft: 8, square: 2 } as const

/** Which of a theme's two color sets to use. */
function resolveMode(appearance: Appearance, prefersDark: boolean): Mode {
  if (appearance.mode === 'light' || appearance.mode === 'dark') return appearance.mode
  if (appearance.mode === 'system') return prefersDark ? 'dark' : 'light'
  return THEMES[appearance.theme].mode
}

/** Black or white text, whichever reads better on a color. */
export function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.4 ? '#0B0B12' : '#FFFFFF'
}

/** Every CSS variable for an appearance, ready to set on the page. */
export function themeVariables(
  appearance: Appearance,
  prefersDark: boolean,
): { mode: Mode; vars: Record<string, string> } {
  const theme = THEMES[appearance.theme]
  const mode = resolveMode(appearance, prefersDark)
  const tokens = { ...theme[mode] }
  if (appearance.accent !== 'theme') {
    const accent =
      appearance.accent in ACCENTS
        ? ACCENTS[appearance.accent as keyof typeof ACCENTS][mode]
        : appearance.accent
    tokens.accent = accent
    tokens['accent-ink'] = inkOn(accent)
  }
  const font = FONTS[appearance.font === 'theme' ? theme.font : appearance.font]
  const radius = appearance.corners === 'theme' ? theme.radius : CORNERS[appearance.corners]
  const compact = appearance.density === 'compact'
  const vars: Record<string, string> = {
    '--font-ui': font.ui,
    '--font-num': font.num,
    '--radius': `${radius}px`,
    '--radius-sm': `${Math.min(radius, 10)}px`,
    '--pad': compact ? '16px' : '24px',
    '--gap': compact ? '12px' : '20px',
  }
  for (const [key, value] of Object.entries(tokens)) vars[`--${key}`] = value
  return { mode, vars }
}

/** Applies an appearance to the whole page. */
export function applyAppearance(appearance: Appearance, prefersDark: boolean): void {
  const { mode, vars } = themeVariables(appearance, prefersDark)
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  root.dataset.mode = mode
  root.style.colorScheme = mode
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg']!)
}

/** Category colors that read well on both light and dark backgrounds. */
export const CATEGORY_COLORS = [
  ['Blue', '#3987E5'],
  ['Orange', '#E0622D'],
  ['Aqua', '#1BA876'],
  ['Pink', '#DE6593'],
  ['Violet', '#7F70E0'],
  ['Green', '#2E9E3A'],
  ['Gold', '#D99A16'],
  ['Slate', '#8390A2'],
] as const
