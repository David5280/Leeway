// The Home cards section: which cards show under Leeway and Heads up, in what
// order and at what size.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../api/client'
import { fakeServer, renderSignedIn, settingsHandlers, settingsWith } from '../../test/fake'
import { WIDGET_LIBRARY } from '../../widgets/library'
import { LayoutSection } from './Layout'

afterEach(() => vi.unstubAllGlobals())

describe('Home cards in Settings', () => {
  const three = settingsWith({
    dashboard: {
      widgets: [
        { type: 'leeway', size: 'wide', visible: true },
        { type: 'pace', size: 'wide', visible: true },
        { type: 'goals', size: 'half', visible: false },
        { type: 'net-worth', size: 'full', visible: true },
      ],
    },
  })

  function sentWidgets(server: ReturnType<typeof fakeServer>) {
    const sent = server.actions('update_settings') as { dashboard: Settings['dashboard'] }[]
    return sent.map((patch) => patch.dashboard.widgets)
  }

  it('lists the cards in order, with whether each shows and its size, leaving Leeway fixed', () => {
    fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const switches = screen.getAllByRole('switch')
    expect(
      switches.map((s) => [s.getAttribute('aria-label'), s.getAttribute('aria-checked')]),
    ).toEqual([
      ['Show Spending pace', 'true'],
      ['Show Your top goal', 'false'],
      ['Show Net worth', 'true'],
    ])
    const size = within(screen.getByRole('group', { name: 'Net worth size' }))
    expect(size.getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows and hides a card', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const user = userEvent.setup()
    await user.click(screen.getByRole('switch', { name: 'Show Your top goal' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]![2]).toEqual({ type: 'goals', size: 'half', visible: true })
    await user.click(screen.getByRole('switch', { name: 'Show Net worth' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(2))
    expect(sentWidgets(server)[1]![3]).toEqual({ type: 'net-worth', size: 'full', visible: false })
  })

  it('changes a card size', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const size = within(screen.getByRole('group', { name: 'Spending pace size' }))
    await userEvent.setup().click(size.getByRole('button', { name: 'Half' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.map((w) => w.size)).toEqual(['wide', 'half', 'half', 'full'])
  })

  it('moves cards up and down, and cannot move past either end', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const user = userEvent.setup()
    expect(screen.getByRole('button', { name: 'Move Spending pace up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Net worth down' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move Net worth up' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    // A full card swaps with the card above it, stepping over Leeway, which stays put.
    expect(sentWidgets(server)[0]!.map((w) => w.type)).toEqual([
      'leeway',
      'pace',
      'net-worth',
      'goals',
    ])
  })

  it('adds a card that is not on Home yet, at the end and half size', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    expect(screen.queryByRole('button', { name: '+ Spending pace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Your leeway' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '+ Top merchants' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.at(-1)).toEqual({
      type: 'merchants',
      size: 'half',
      visible: true,
    })
    expect(await screen.findByRole('switch', { name: 'Show Top merchants' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Top merchants' })).not.toBeInTheDocument()
  })

  it('offers nothing to add once every card is on Home', () => {
    const everything = settingsWith({
      dashboard: {
        widgets: Object.keys(WIDGET_LIBRARY).map((type) => ({ type })),
      },
    })
    fakeServer(settingsHandlers(everything))
    renderSignedIn(<LayoutSection />, { settings: everything })
    expect(screen.queryByText('Add:')).not.toBeInTheDocument()
  })

  it('lists only the cards the owner arranges, leaving out Leeway and Heads up', () => {
    const saved = settingsWith({
      dashboard: { widgets: [{ type: 'leeway' }, { type: 'alerts' }, { type: 'pace' }] },
    })
    fakeServer(settingsHandlers(saved))
    renderSignedIn(<LayoutSection />, { settings: saved })
    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Show Spending pace',
    ])
  })

  it('keeps Leeway and Heads up in the saved list when saving a change', async () => {
    const saved = settingsWith({
      dashboard: { widgets: [{ type: 'leeway' }, { type: 'alerts' }, { type: 'pace' }] },
    })
    const server = fakeServer(settingsHandlers(saved))
    renderSignedIn(<LayoutSection />, { settings: saved })
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Show Spending pace' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.map((w) => w.type)).toEqual(['leeway', 'alerts', 'pace'])
  })
})
