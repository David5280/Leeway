// The Customize page as a whole: its section links, hints and save errors.
// Each section has its own tests next to it, in pages/customize/.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn, weeklyEmailHandlers } from '../test/fake'
import { Customize } from './Customize'

afterEach(() => vi.unstubAllGlobals())

/** Sections that list things, here with nothing to list. */
const noLists = {
  list_accounts: () => [],
  list_tokens: () => [],
  list_connected_apps: () => [],
}

describe('Customize page', () => {
  it('links to every section by its anchor, with the section title as the link text', () => {
    fakeServer({ ...noLists, ...weeklyEmailHandlers() })
    renderSignedIn(<Customize />)
    expect(screen.getByRole('heading', { name: 'Make it yours', level: 1 })).toBeInTheDocument()
    const links = within(
      screen.getByRole('navigation', { name: 'Customize sections' }),
    ).getAllByRole('link')
    expect(links).toHaveLength(10)
    for (const link of links) {
      const id = link.getAttribute('href')!.slice(1)
      const section = document.getElementById(id)
      expect(section, `section for ${id}`).not.toBeNull()
      expect(screen.getByRole('region', { name: link.textContent! })).toBe(section)
    }
  })

  it('shows each section hint under its title', () => {
    fakeServer({ ...noLists, ...weeklyEmailHandlers() })
    renderSignedIn(<Customize />)
    expect(screen.getByRole('region', { name: 'Accounts' })).toHaveTextContent(
      'Hidden accounts stay out of every total',
    )
    expect(screen.getByRole('region', { name: 'Look' }).querySelector('.muted')).toBeNull()
  })

  it('shows a message when a settings change fails to save', async () => {
    fakeServer(
      { ...noLists, ...weeklyEmailHandlers() },
      { '/api/actions/update_settings': failing('Settings could not be saved') },
    )
    renderSignedIn(<Customize />)
    const look = screen.getByRole('region', { name: 'Look' })
    await userEvent.setup().click(within(look).getByRole('button', { name: /Harbor/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be saved')
  })
})
