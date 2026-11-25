// Home's cards are the owner's to shape: add, hide, resize and reorder them,
// saved as they go. Leeway and Heads up stay fixed at the top, with no tools.

import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settings } from '../test/fake'
import { debtPlans } from '../test/planning'
import {
  layout,
  renderHome,
  sentLayouts,
  serveHome,
  shownCards,
  startEditing,
  toolsFor,
} from '../test/overview'
import { DEFAULT_LAYOUT, WIDGET_LIBRARY, type WidgetType } from '../widgets/library'

afterEach(() => vi.unstubAllGlobals())

const types = (widgets: { type: string }[]) => widgets.map((widget) => widget.type)

/** The four tab cards the tab row also shows, each a card of its own too. */
const TAB_CARD_TYPES = new Set<WidgetType>(['cash-flow', 'pace', 'goals', 'net-worth'])

/** Each saved card's type and whether it shows. */
const visibility = (widgets: { type: string; visible: boolean }[]) =>
  widgets.map((widget) => [widget.type, widget.visible])

/** Refuses a change, as the server does with a bad layout. */
const refuse = () =>
  Response.json({ error: 'invalid_input', message: 'Layout could not be saved' }, { status: 400 })

describe('editing Home', () => {
  it('turns editing on and off', async () => {
    serveHome()
    renderHome()
    const user = await startEditing()
    const toggle = screen.getByRole('button', { name: 'Done' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Move, resize or hide the cards below/)).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Edit layout' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(document.querySelector('.widget-tools')).toBeNull()
  })

  it('gives Leeway and Heads up no tools, so they cannot be hidden or moved', async () => {
    serveHome()
    renderHome()
    await startEditing()
    expect(screen.queryByRole('button', { name: /Move Your leeway/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Heads up', { selector: '.widget-tools strong' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Your leeway' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Heads up' })).not.toBeInTheDocument()
    expect(toolsFor('Tab summaries').getByRole('button', { name: 'Hide' })).toBeInTheDocument()
  })

  it('moves a card within its column and saves the new order', async () => {
    const server = serveHome()
    renderHome()
    const user = await startEditing()
    await user.click(
      toolsFor('Latest activity').getByRole('button', { name: 'Move Latest activity up' }),
    )
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(types(sentLayouts(server)[0]!)).toEqual([
      'leeway',
      'alerts',
      'account-list',
      'latest-activity',
      'coming-up',
      'tab-row',
    ])
    await waitFor(() =>
      expect(shownCards().slice(1, 4)).toEqual(['Accounts', 'Latest activity', 'Due by payday']),
    )
  })

  it('cannot move the first card up or the last one down', async () => {
    serveHome()
    renderHome()
    await startEditing()
    expect(toolsFor('Accounts').getByRole('button', { name: 'Move Accounts up' })).toBeDisabled()
    expect(
      toolsFor('Tab summaries').getByRole('button', { name: 'Move Tab summaries down' }),
    ).toBeDisabled()
  })

  it('resizes a card', async () => {
    const server = serveHome()
    renderHome()
    const user = await startEditing()
    const name = 'Due by payday'
    const size = toolsFor(name).getByRole('group', { name: `${name} size` })
    await user.click(within(size).getByRole('button', { name: 'Full' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]![3]).toEqual({ type: 'coming-up', size: 'full', visible: true })
  })

  it('hides a card, keeping it in edit mode to show again', async () => {
    const server = serveHome()
    renderHome()
    const user = await startEditing()
    await user.click(toolsFor('Latest activity').getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]![4]).toEqual({
      type: 'latest-activity',
      size: 'half',
      visible: false,
    })
    expect(toolsFor('Latest activity').getByRole('button', { name: 'Show' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('region', { name: 'Latest activity' })).not.toBeInTheDocument()
  })

  it('shows a hidden card again', async () => {
    const hidden = layout([{ type: 'leeway' }, { type: 'debts', visible: false }])
    const server = serveHome(hidden, { plan_debt_payoff: () => debtPlans([]) })
    renderHome(hidden)
    const user = await startEditing()
    await user.click(toolsFor('Debt payoff').getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]![1]).toMatchObject({ type: 'debts', visible: true })
  })

  it('adds a card that is not on Home, at the end and half size', async () => {
    const server = serveHome()
    renderHome()
    const user = await startEditing()
    await user.click(screen.getByRole('button', { name: '+ Top merchants' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]!.at(-1)).toEqual({
      type: 'merchants',
      size: 'half',
      visible: true,
    })
    expect(await screen.findByRole('region', { name: 'Top merchants' })).toBeInTheDocument()
  })

  it('offers nothing to add once every card is on Home', async () => {
    const library = Object.keys(WIDGET_LIBRARY) as WidgetType[]
    // The tab cards on their own sit hidden, as they never show beside the tab row.
    const everything = layout(library.map((type) => ({ type, visible: !TAB_CARD_TYPES.has(type) })))
    serveHome(everything)
    renderHome(everything)
    await startEditing()
    expect(screen.queryByText('Add a card')).not.toBeInTheDocument()
  })

  it("resets to the map's order", async () => {
    const custom = layout([{ type: 'net-worth' }, { type: 'pace', visible: false }])
    const server = serveHome(custom)
    renderHome(custom)
    const user = await startEditing()
    await user.click(screen.getByRole('button', { name: 'Reset layout' }))
    await waitFor(() => expect(sentLayouts(server)).toEqual([DEFAULT_LAYOUT]))
  })

  it('keeps Leeway and Heads up in the saved list when saving a change', async () => {
    const saved = layout([{ type: 'leeway' }, { type: 'alerts' }, { type: 'pace' }])
    const server = serveHome(saved)
    renderHome(saved)
    const user = await startEditing()
    await user.click(toolsFor('Spending pace').getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]!.map((w) => [w.type, w.visible])).toEqual([
      ['leeway', true],
      ['alerts', true],
      ['pace', false],
    ])
  })

  it('puts the layout back, and says why, when the server refuses the change', async () => {
    serveHome(settings, {}, { '/api/actions/update_settings': refuse })
    renderHome()
    const user = await startEditing()
    await user.click(toolsFor('Tab summaries').getByRole('button', { name: 'Hide' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Layout could not be saved')
    expect(toolsFor('Tab summaries').getByRole('button', { name: 'Hide' })).toBeInTheDocument()
  })
})

describe('the tab row and the tab cards on their own', () => {
  it('offers a tab card while the row is hidden, and adding it drops the hidden row', async () => {
    const rowHidden = layout([{ type: 'leeway' }, { type: 'tab-row', visible: false }])
    const server = serveHome(rowHidden)
    renderHome(rowHidden)
    const user = await startEditing()
    expect(screen.queryByRole('button', { name: '+ Tab summaries' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Spending pace' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(visibility(sentLayouts(server)[0]!)).toEqual([
      ['leeway', true],
      ['pace', true],
    ])
  })

  it('offers the row while the tab cards are hidden, and adding it drops them', async () => {
    const cardsHidden = layout([
      { type: 'leeway' },
      { type: 'pace', visible: false },
      { type: 'goals', visible: false },
    ])
    const server = serveHome(cardsHidden)
    renderHome(cardsHidden)
    const user = await startEditing()
    await user.click(screen.getByRole('button', { name: '+ Tab summaries' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(types(sentLayouts(server)[0]!)).toEqual(['leeway', 'tab-row'])
  })

  it('hides the row when a tab card on its own is shown', async () => {
    const saved = layout([
      { type: 'leeway' },
      { type: 'tab-row' },
      { type: 'pace', visible: false },
    ])
    const server = serveHome(saved)
    renderHome(saved)
    const user = await startEditing()
    await user.click(toolsFor('Spending pace').getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(visibility(sentLayouts(server)[0]!)).toEqual([
      ['leeway', true],
      ['tab-row', false],
      ['pace', true],
    ])
  })

  it('hides the tab cards on their own when the row is shown', async () => {
    const saved = layout([
      { type: 'leeway' },
      { type: 'tab-row', visible: false },
      { type: 'pace' },
    ])
    const server = serveHome(saved)
    renderHome(saved)
    const user = await startEditing()
    await user.click(toolsFor('Tab summaries').getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(visibility(sentLayouts(server)[0]!)).toEqual([
      ['leeway', true],
      ['tab-row', true],
      ['pace', false],
    ])
  })
})
