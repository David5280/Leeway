// The Planning section: the birth year, changed or removed after it was first
// asked, kept in step with changes made elsewhere, and how a typed year is read.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_KEY } from '../../api/settings'
import type { Settings } from '../../api/client'
import { readBirthYear } from '../../components/BirthYearForm'
import {
  failing,
  fakeServer,
  holdRequest,
  renderSignedIn,
  settingsHandlers,
  settingsWith,
} from '../../test/fake'
import { SCREEN_ROUTES } from '../../routes'
import { SettingsPage } from '../Settings'
import { PlanningSection } from './Planning'

afterEach(() => vi.unstubAllGlobals())

const born1986 = settingsWith({ retirement: { birthYear: 1986 } })
const yearField = () => screen.getByRole('textbox', { name: 'Year you were born' })

describe('Planning', () => {
  it('shows the year saved and saves a new one', async () => {
    const server = fakeServer(settingsHandlers(born1986))
    renderSignedIn(<PlanningSection />, { settings: born1986 })
    const field = yearField()
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

  it('starts empty, with nothing to remove, when the year has not been given', () => {
    fakeServer(settingsHandlers())
    renderSignedIn(<PlanningSection />)
    expect(yearField()).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('removes the year, leaving the field empty', async () => {
    const server = fakeServer(settingsHandlers(born1986))
    renderSignedIn(<PlanningSection />, { settings: born1986 })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ retirement: { birthYear: null } }]),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Removed.')
    expect(yearField()).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('shows a year changed elsewhere, such as by an assistant', async () => {
    fakeServer(settingsHandlers(born1986))
    const { client } = renderSignedIn(<PlanningSection />, { settings: born1986 })
    const user = userEvent.setup()
    await user.clear(yearField())
    await user.type(yearField(), '19')
    client.setQueryData(SETTINGS_KEY, settingsWith({ retirement: { birthYear: 1990 } }))
    await waitFor(() => expect(yearField()).toHaveValue('1990'))
  })

  it('previews the new year at once, keeping every other retirement assumption', async () => {
    const chosen = settingsWith({ retirement: { birthYear: 1986, retirementAge: 60 } })
    fakeServer(settingsHandlers(chosen))
    const release = holdRequest('/api/actions/update_settings')
    const { client } = renderSignedIn(<PlanningSection />, { settings: chosen })
    const user = userEvent.setup()
    await user.clear(yearField())
    await user.type(yearField(), '1984')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const cached = () => client.getQueryData<Settings>(SETTINGS_KEY)!.retirement
    await waitFor(() => expect(cached().birthYear).toBe(1984))
    expect(cached()).toEqual({ ...chosen.retirement, birthYear: 1984 })
    release()
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
  })

  it('shows a failed save once, at the top of Settings, not again in the section', async () => {
    fakeServer(settingsHandlers(born1986), {
      '/api/actions/update_settings': failing('Database is down', 500),
    })
    renderSignedIn(
      <Routes>
        <Route path={SCREEN_ROUTES.settings} element={<SettingsPage />} />
      </Routes>,
      { settings: born1986, route: '/settings/planning' },
    )
    const user = userEvent.setup()
    await user.clear(yearField())
    await user.type(yearField(), '1984')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    const section = screen.getByRole('form', { name: 'Birth year' })
    expect(within(section).queryByRole('alert')).toBeNull()
    // The field goes back to the year actually saved, as the preview does.
    await waitFor(() => expect(yearField()).toHaveValue('1986'))
  })
})

describe('reading a birth year', () => {
  const today = '2026-11-17'

  it('takes four digits from 110 years back to this year, spaces aside', () => {
    expect(readBirthYear(' 1986 ', today)).toEqual({ ok: true, year: 1986 })
    expect(readBirthYear('1916', today)).toEqual({ ok: true, year: 1916 })
    expect(readBirthYear('2026', today)).toEqual({ ok: true, year: 2026 })
  })

  it('asks for four digits when it is not four digits', () => {
    for (const text of ['86', '1986-05-04', '', 'nineteen', '19 86', '-1986']) {
      expect(readBirthYear(text, today)).toEqual({
        ok: false,
        error: 'Enter the year as four digits, like 1986.',
      })
    }
  })

  it('says what range to use for four digits outside it', () => {
    expect(readBirthYear('2027', today)).toEqual({
      ok: false,
      error: 'Use a birth year of 2026 or earlier, since 2027 is still to come.',
    })
    expect(readBirthYear('1915', today)).toEqual({
      ok: false,
      error: 'Use a birth year of 1916 or later.',
    })
    // The year turns over on New Year's Day.
    expect(readBirthYear('2027', '2027-01-01')).toEqual({ ok: true, year: 2027 })
  })
})
