// The Dashboard layout section: which widgets show, in what order and at what size.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../api/client'
import {
  fakeServer,
  forgetWidgets,
  renderSignedIn,
  settingsHandlers,
  settingsWith,
} from '../../test/fake'
import { WIDGET_LIBRARY } from '../../widgets/library'
import { LayoutSection } from './Layout'

afterEach(() => vi.unstubAllGlobals())

describe('Dashboard layout', () => {
  const three = settingsWith({
    dashboard: {
      widgets: [
        { type: 'leeway', size: 'wide', visible: true },
        { type: 'glance', size: 'half', visible: false },
        { type: 'recent', size: 'full', visible: true },
      ],
    },
  })

  function sentWidgets(server: ReturnType<typeof fakeServer>) {
    const sent = server.actions('update_settings') as { dashboard: Settings['dashboard'] }[]
    return sent.map((patch) => patch.dashboard.widgets)
  }

  it('lists the widgets in order, with whether each shows and its size', () => {
    fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const switches = screen.getAllByRole('switch')
    expect(
      switches.map((s) => [s.getAttribute('aria-label'), s.getAttribute('aria-checked')]),
    ).toEqual([
      ['Show Your leeway', 'true'],
      ['Show At a glance', 'false'],
      ['Show Recent', 'true'],
    ])
    const size = within(screen.getByRole('group', { name: 'Recent size' }))
    expect(size.getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows and hides a widget', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const user = userEvent.setup()
    await user.click(screen.getByRole('switch', { name: 'Show At a glance' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]![1]).toEqual({ type: 'glance', size: 'half', visible: true })
    await user.click(screen.getByRole('switch', { name: 'Show Your leeway' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(2))
    expect(sentWidgets(server)[1]![0]).toEqual({ type: 'leeway', size: 'wide', visible: false })
  })

  it('changes a widget size', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const size = within(screen.getByRole('group', { name: 'Your leeway size' }))
    await userEvent.setup().click(size.getByRole('button', { name: 'Half' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.map((w) => w.size)).toEqual(['half', 'half', 'full'])
  })

  it('moves widgets up and down, and cannot move past either end', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const user = userEvent.setup()
    expect(screen.getByRole('button', { name: 'Move Your leeway up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Recent down' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move Recent up' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.map((w) => w.type)).toEqual(['leeway', 'recent', 'glance'])
    await user.click(screen.getByRole('button', { name: 'Move Your leeway down' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(2))
    expect(sentWidgets(server)[1]!.map((w) => w.type)).toEqual(['recent', 'leeway', 'glance'])
  })

  it('adds a widget that is not on the dashboard yet, at the end and wide', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    expect(screen.queryByRole('button', { name: '+ Recent' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '+ Top merchants' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.at(-1)).toEqual({
      type: 'merchants',
      size: 'wide',
      visible: true,
    })
    expect(await screen.findByRole('switch', { name: 'Show Top merchants' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Top merchants' })).not.toBeInTheDocument()
  })

  it('offers nothing to add once every widget is on the dashboard', () => {
    const everything = settingsWith({
      dashboard: {
        widgets: Object.keys(WIDGET_LIBRARY).map((type) => ({ type })),
      },
    })
    fakeServer(settingsHandlers(everything))
    renderSignedIn(<LayoutSection />, { settings: everything })
    expect(screen.queryByText('Add:')).not.toBeInTheDocument()
  })

  it('leaves out widgets this app cannot draw yet', () => {
    forgetWidgets('bills')
    const future = settingsWith({
      dashboard: { widgets: [{ type: 'bills' }, { type: 'leeway' }] },
    })
    fakeServer(settingsHandlers(future))
    renderSignedIn(<LayoutSection />, { settings: future })
    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Show Your leeway',
    ])
  })

  it('keeps widgets this app cannot draw when saving a change', async () => {
    forgetWidgets('bills')
    const future = settingsWith({
      dashboard: { widgets: [{ type: 'bills' }, { type: 'leeway' }] },
    })
    const server = fakeServer(settingsHandlers(future))
    renderSignedIn(<LayoutSection />, { settings: future })
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Show Your leeway' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.map((w) => w.type)).toContain('bills')
  })
})
