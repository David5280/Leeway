// The Region section: currency, number format and time zone.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn, settingsHandlers, settingsWith } from '../../test/fake'
import { RegionSection } from './Region'

afterEach(() => vi.unstubAllGlobals())

describe('Region', () => {
  it('saves a currency, naming each one', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<RegionSection />)
    const currency = screen.getByRole('combobox', { name: 'Currency' })
    expect(currency).toHaveValue('USD')
    await userEvent.setup().selectOptions(currency, 'Euro (EUR)')
    await waitFor(() => expect(server.actions('update_settings')).toEqual([{ currency: 'EUR' }]))
  })

  it('shows a sample amount for each number format and saves one', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<RegionSection />)
    const locale = screen.getByRole('combobox', { name: 'Number format' })
    expect(within(locale).getByRole('option', { name: '$1,234.56 (en-US)' })).toBeInTheDocument()
    await userEvent.setup().selectOptions(locale, 'de-DE')
    await waitFor(() => expect(server.actions('update_settings')).toEqual([{ locale: 'de-DE' }]))
    expect(within(locale).getByRole('option', { name: /\(de-DE\)/ }).textContent).toMatch(
      /1\.234,56/,
    )
  })

  it('saves a time zone', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<RegionSection />)
    const zone = screen.getByRole('combobox', { name: 'Time zone' })
    expect(zone).toHaveValue('America/Denver')
    await userEvent.setup().selectOptions(zone, 'Europe/Berlin')
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ timeZone: 'Europe/Berlin' }]),
    )
  })

  it('keeps a saved currency, format and zone that are not in the lists, first', () => {
    // US/Mountain is valid but not canonical, so the browser's list leaves it out.
    const unusual = settingsWith({ currency: 'ISK', locale: 'fi-FI', timeZone: 'US/Mountain' })
    fakeServer(settingsHandlers(unusual))
    renderSignedIn(<RegionSection />, { settings: unusual })
    for (const [name, value] of [
      ['Currency', 'ISK'],
      ['Number format', 'fi-FI'],
      ['Time zone', 'US/Mountain'],
    ]) {
      const select = screen.getByRole('combobox', { name })
      expect(select).toHaveValue(value)
      expect(within(select).getAllByRole('option')[0]).toHaveValue(value)
    }
  })
})
