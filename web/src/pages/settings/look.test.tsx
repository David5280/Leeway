// The Look section: theme, font and accent color.

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { themeVariables } from '../../lib/theme'
import {
  failing,
  fakeServer,
  renderSignedIn,
  settings,
  settingsHandlers,
  settingsWith,
} from '../../test/fake'
import { hexOrFallback, LookSection } from './Look'

afterEach(() => vi.unstubAllGlobals())

describe('Look', () => {
  function look() {
    return screen.getByRole('region', { name: 'Look' })
  }

  it('offers every theme and marks the current one', () => {
    fakeServer(settingsHandlers())
    renderSignedIn(<LookSection />)
    const themes = ['Night', 'Harbor', 'Neon'].map((name) =>
      within(look()).getByRole('button', { name: new RegExp(name) }),
    )
    expect(themes.map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
  })

  it('saves a theme and shows it before the server answers', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<LookSection />)
    await userEvent.setup().click(within(look()).getByRole('button', { name: /Neon/ }))
    expect(within(look()).getByRole('button', { name: /Neon/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ appearance: { theme: 'neon' } }]),
    )
  })

  it('puts the old theme back when the server refuses the change', async () => {
    const server = fakeServer({}, { '/api/actions/update_settings': failing('No') })
    renderSignedIn(<LookSection />)
    await userEvent.setup().click(within(look()).getByRole('button', { name: /Harbor/ }))
    await waitFor(() => expect(server.actions('update_settings')).toHaveLength(1))
    await waitFor(() =>
      expect(within(look()).getByRole('button', { name: /Night/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
  })

  it.each([
    ['Light or dark', 'Dark', { mode: 'dark' }],
    ['Light or dark', 'Match my device', { mode: 'system' }],
    ['Density', 'Compact', { density: 'compact' }],
    ['Corners', 'Square', { corners: 'square' }],
    ['Corners', 'Round', { corners: 'round' }],
  ])('saves %s: %s', async (group, option, appearance) => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<LookSection />)
    const buttons = within(screen.getByRole('group', { name: group }))
    await userEvent.setup().click(buttons.getByRole('button', { name: option }))
    expect(buttons.getByRole('button', { name: option })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(server.actions('update_settings')).toEqual([{ appearance }]))
  })

  it('saves a font picked from the list', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<LookSection />)
    const font = screen.getByRole('combobox', { name: 'Font' })
    expect(font).toHaveValue('theme')
    await userEvent.setup().selectOptions(font, 'IBM Plex')
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ appearance: { font: 'ibm-plex' } }]),
    )
    expect(font).toHaveValue('ibm-plex')
  })

  describe('accent color', () => {
    function accents() {
      return within(screen.getByRole('radiogroup', { name: 'Accent color' }))
    }

    it('starts on the theme accent with the picker at the theme color', () => {
      fakeServer(settingsHandlers())
      renderSignedIn(<LookSection />)
      expect(accents().getByRole('radio', { name: 'Theme' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      // jsdom has no matchMedia, so the app treats the device as dark.
      const themeAccent = themeVariables(settings.appearance, true).vars['--accent']
      expect(accents().getByLabelText('Pick a custom accent color')).toHaveValue(
        hexOrFallback(themeAccent).toLowerCase(),
      )
    })

    it('saves a preset and checks only that one', async () => {
      const server = fakeServer(settingsHandlers())
      renderSignedIn(<LookSection />)
      await userEvent.setup().click(accents().getByRole('radio', { name: 'Teal' }))
      await waitFor(() =>
        expect(server.actions('update_settings')).toEqual([{ appearance: { accent: 'teal' } }]),
      )
      const checked = accents()
        .getAllByRole('radio')
        .filter((r) => r.getAttribute('aria-checked') === 'true')
      expect(checked.map((r) => r.getAttribute('aria-label') ?? r.textContent)).toEqual(['Teal'])
    })

    it('goes back to the theme accent', async () => {
      const server = fakeServer(settingsHandlers(settingsWith({ appearance: { accent: 'pink' } })))
      renderSignedIn(<LookSection />, {
        settings: settingsWith({ appearance: { accent: 'pink' } }),
      })
      expect(accents().getByRole('radio', { name: 'Pink' })).toHaveAttribute('aria-checked', 'true')
      await userEvent.setup().click(accents().getByRole('radio', { name: 'Theme' }))
      await waitFor(() =>
        expect(server.actions('update_settings')).toEqual([{ appearance: { accent: 'theme' } }]),
      )
    })

    it('saves any color from the picker as a custom accent', async () => {
      const server = fakeServer(settingsHandlers())
      renderSignedIn(<LookSection />)
      fireEvent.change(accents().getByLabelText('Pick a custom accent color'), {
        target: { value: '#ff8800' },
      })
      await waitFor(() =>
        expect(server.actions('update_settings')).toEqual([{ appearance: { accent: '#ff8800' } }]),
      )
      expect(accents().getByLabelText('Pick a custom accent color')).toHaveValue('#ff8800')
    })

    it('shows a saved custom accent in the picker with no preset checked', () => {
      fakeServer(settingsHandlers())
      renderSignedIn(<LookSection />, {
        settings: settingsWith({ appearance: { accent: '#123abc' } }),
      })
      expect(accents().getByLabelText('Pick a custom accent color')).toHaveValue('#123abc')
      expect(accents().getByLabelText('Custom color')).toHaveStyle({ background: '#123abc' })
      expect(
        accents()
          .getAllByRole('radio')
          .every((r) => r.getAttribute('aria-checked') === 'false'),
      ).toBe(true)
    })
  })

  describe('hexOrFallback', () => {
    it('keeps a hex color', () => {
      expect(hexOrFallback('#86A8FF')).toBe('#86A8FF')
    })

    it.each([undefined, '', 'rgb(1, 2, 3)', 'oklch(70% 0.1 250)', 'blue'])(
      'falls back to the default blue for %j',
      (color) => {
        expect(hexOrFallback(color)).toBe('#4f8cff')
      },
    )
  })
})
