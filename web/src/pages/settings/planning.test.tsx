// The Planning section: the birth year, changed after it was first asked.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readBirthYear } from '../../components/BirthYearForm'
import { fakeServer, renderSignedIn, settingsHandlers, settingsWith } from '../../test/fake'
import { PlanningSection } from './Planning'

afterEach(() => vi.unstubAllGlobals())

describe('Planning', () => {
  const born1986 = settingsWith({ retirement: { birthYear: 1986 } })

  it('shows the year saved and saves a new one', async () => {
    const server = fakeServer(settingsHandlers(born1986))
    renderSignedIn(<PlanningSection />, { settings: born1986 })
    const field = screen.getByRole('textbox', { name: 'Year you were born' })
    expect(field).toHaveValue('1986')
    const user = userEvent.setup()
    await user.clear(field)
    await user.type(field, '1984')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ retirement: { birthYear: 1984 } }]),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    // Typing again means the new year is not saved yet.
    await user.clear(field)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('starts empty when the year has not been given', () => {
    fakeServer(settingsHandlers())
    renderSignedIn(<PlanningSection />)
    expect(screen.getByRole('textbox', { name: 'Year you were born' })).toHaveValue('')
  })
})

describe('reading a birth year', () => {
  it('takes four digits from 1900 to this year, spaces aside', () => {
    expect(readBirthYear(' 1986 ', 2026)).toBe(1986)
    expect(readBirthYear('1900', 2026)).toBe(1900)
    expect(readBirthYear('2026', 2026)).toBe(2026)
  })

  it('refuses a short year, a year to come, one before 1900 and a full date', () => {
    for (const text of ['86', '2027', '1899', '1986-05-04', '', 'nineteen']) {
      expect(readBirthYear(text, 2026)).toBeNull()
    }
  })
})
