import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settings } from '../test/fake'
import { useAppearance } from './app'
import { applyAppearance, FONTS, inkOn, NUMBER_MARKS, THEMES, themeVariables } from './theme'

afterEach(() => vi.unstubAllGlobals())

const base = settings.appearance

describe('theme', () => {
  it('uses the theme defaults: Night is dark', () => {
    const { mode, vars } = themeVariables(base, false)
    expect(mode).toBe('dark')
    expect(vars['--bg']).toBe(THEMES.night.dark.bg)
    expect(vars['--radius']).toBe(`${THEMES.night.radius}px`)
  })

  it('follows the device when asked', () => {
    expect(themeVariables({ ...base, mode: 'system' }, false).mode).toBe('light')
    expect(themeVariables({ ...base, mode: 'system' }, true).mode).toBe('dark')
  })

  it('layers accent, corners, density and font on top', () => {
    const { vars } = themeVariables(
      { ...base, accent: '#ffcc00', corners: 'square', density: 'compact', font: 'system' },
      true,
    )
    expect(vars['--accent']).toBe('#ffcc00')
    expect(vars['--accent-ink']).toBe('#0B0B12')
    expect(vars['--radius']).toBe('2px')
    expect(vars['--pad']).toBe('16px')
    expect(vars['--font-ui']).toContain('system-ui')
  })

  it('sets money in each font with tight commas and points ahead of its monospaced digits', () => {
    for (const font of Object.values(FONTS))
      expect(font.num.startsWith(`${NUMBER_MARKS}, `)).toBe(true)
    // The face is declared in styles.css under this very name.
    expect(NUMBER_MARKS).toBe("'Leeway Number Marks'")
    expect(themeVariables({ ...base, font: 'ibm-plex' }, true).vars['--font-num']).toBe(
      `${NUMBER_MARKS}, 'IBM Plex Mono', ui-monospace, monospace`,
    )
  })

  it('picks readable text for a color', () => {
    expect(inkOn('#000000')).toBe('#FFFFFF')
    expect(inkOn('#FFFFFF')).toBe('#0B0B12')
  })

  it('applies to the page', () => {
    applyAppearance({ ...base, theme: 'harbor' }, false)
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe(THEMES.harbor.light.bg)
    expect(document.documentElement.dataset.mode).toBe('light')
  })
})

/** A stand-in for the device's dark mode setting that a test can flip. */
function fakeDevice(dark: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: dark,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', () => media)
  return {
    listeners,
    switchTo(next: boolean) {
      media.matches = next
      act(() => listeners.forEach((listener) => listener()))
    },
  }
}

describe('following the device', () => {
  it('repaints the page when the device switches between light and dark', () => {
    const device = fakeDevice(false)
    renderHook(() => useAppearance({ ...base, mode: 'system' }))
    expect(document.documentElement.dataset.mode).toBe('light')
    device.switchTo(true)
    expect(document.documentElement.dataset.mode).toBe('dark')
  })

  it('stops listening to the device once the page is gone', () => {
    const device = fakeDevice(false)
    const { unmount } = renderHook(() => useAppearance(base))
    expect(device.listeners.size).toBe(1)
    unmount()
    expect(device.listeners.size).toBe(0)
  })
})
