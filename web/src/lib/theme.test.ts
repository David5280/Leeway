import { describe, expect, it } from 'vitest'
import { settings } from '../test/fake'
import { applyAppearance, inkOn, THEMES, themeVariables } from './theme'

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
