// The Budgeting section: the budget period, pending transactions, warnings and pace.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn, settingsHandlers, settingsWith } from '../../test/fake'
import { BudgetingSection } from './Budgeting'

afterEach(() => vi.unstubAllGlobals())

describe('Budgeting', () => {
  it('switches the budget period kind', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const period = within(screen.getByRole('group', { name: 'Budget period' }))
    await userEvent.setup().click(period.getByRole('button', { name: 'Weekly' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { period: { kind: 'weekly', weekStartsOn: 1 } },
      ]),
    )
    expect(await screen.findByRole('combobox', { name: 'Week starts on' })).toHaveValue('1')
  })

  it('does not save when the current period kind is picked again', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const period = within(screen.getByRole('group', { name: 'Budget period' }))
    await userEvent.setup().click(period.getByRole('button', { name: 'Monthly' }))
    expect(server.actions('update_settings')).toEqual([])
  })

  it('saves the day a month starts', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'Month starts on day' }), '15')
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { period: { kind: 'monthly', startDay: 15 } },
      ]),
    )
  })

  it('turns counting pending transactions off', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const pending = screen.getByRole('switch', { name: 'Count pending transactions' })
    expect(pending).toHaveAttribute('aria-checked', 'true')
    await userEvent.setup().click(pending)
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ includePending: false }]),
    )
    expect(pending).toHaveAttribute('aria-checked', 'false')
  })

  it('saves the warning threshold as a number', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const warn = screen.getByRole('combobox', { name: 'Warn at' })
    expect(warn).toHaveValue('80')
    await userEvent.setup().selectOptions(warn, '90% of a budget')
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ defaultWarnAtPercent: 90 }]),
    )
  })

  it('keeps a threshold that is not in the list, such as one an agent set', () => {
    const odd = settingsWith({ defaultWarnAtPercent: 83 })
    fakeServer(settingsHandlers(odd))
    renderSignedIn(<BudgetingSection />, { settings: odd })
    const warn = screen.getByRole('combobox', { name: 'Warn at' })
    expect(warn).toHaveValue('83')
    expect(within(warn).getByRole('option', { name: '83% of a budget' })).toBeInTheDocument()
    // Listed in order, between 80 and 85.
    const values = within(warn)
      .getAllByRole('option')
      .map((o) => o.getAttribute('value'))
    expect(values.slice(4, 7)).toEqual(['80', '83', '85'])
  })

  it('saves pace sensitivity and says what it means', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const pace = within(screen.getByRole('group', { name: 'Pace sensitivity' }))
    expect(pace.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/10% of the budget/)).toBeInTheDocument()
    await userEvent.setup().click(pace.getByRole('button', { name: 'Strict' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ paceTolerancePercent: 5 }]),
    )
    expect(screen.getByText(/5% of the budget/)).toBeInTheDocument()
  })

  it('states an unusual pace sensitivity in the hint', () => {
    const odd = settingsWith({ paceTolerancePercent: 33 })
    fakeServer(settingsHandlers(odd))
    renderSignedIn(<BudgetingSection />, { settings: odd })
    expect(screen.getByText(/33% of the budget/)).toBeInTheDocument()
  })

  it('marks an unusual pace sensitivity as its own choice, not as Normal', () => {
    const odd = settingsWith({ paceTolerancePercent: 33 })
    fakeServer(settingsHandlers(odd))
    renderSignedIn(<BudgetingSection />, { settings: odd })
    const pace = within(screen.getByRole('group', { name: 'Pace sensitivity' }))
    expect(pace.getByRole('button', { name: 'Custom (33%)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(pace.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'false')
  })
})
