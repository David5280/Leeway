// Home as the map draws it: Leeway, then Heads up only when something needs
// the owner, then one card per tab in the map's order, each opening its tab.
// Leeway and Heads up stay first whatever the saved layout says. Editing the
// cards is in overviewEditing.test.tsx.

import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { account, alertsFor, forgetWidgets, settings } from '../test/fake'
import { homeList } from '../test/homeAlerts'
import { layout, renderHome, serveHome, shownCards } from '../test/overview'

afterEach(() => vi.unstubAllGlobals())

/** The tab cards by default, in the map's order. */
const TAB_CARDS = ['Cash to payday', 'Spending pace', 'Your top goal', 'Net worth']

const alerts = alertsFor([account({ id: 'a', name: 'Everyday', balanceCents: -4210 })])
/** An overdrawn account, so Heads up has something to say. */
const somethingNeedsYou = {
  list_alerts: () => alerts,
  list_home_alerts: () => homeList(alerts),
}

describe('Home', () => {
  it("leads with Leeway, then the four tab cards in the map's order", async () => {
    serveHome()
    renderHome()
    await waitFor(() => expect(shownCards()).toEqual(['Your leeway', ...TAB_CARDS]))
    // Nothing needs the owner, so Heads up takes no room at all.
    expect(screen.queryByRole('region', { name: 'Heads up' })).not.toBeInTheDocument()
  })

  it('puts Heads up right under Leeway when something needs the owner', async () => {
    serveHome(settings, somethingNeedsYou)
    renderHome()
    await screen.findByText('Everyday is overdrawn by $42.10.')
    await waitFor(() => expect(shownCards()).toEqual(['Your leeway', 'Heads up', ...TAB_CARDS]))
  })

  it('opens each tab from its card', async () => {
    serveHome()
    renderHome()
    // Each card is one link once its figure has loaded.
    const opens = (name: string) =>
      waitFor(() =>
        within(screen.getByRole('region', { name })).getByRole('link').getAttribute('href'),
      )
    expect(await opens('Cash to payday')).toBe('/payday')
    expect(await opens('Spending pace')).toBe('/spending')
    expect(await opens('Your top goal')).toBe('/goals')
    expect(await opens('Net worth')).toBe('/wealth')
  })

  it('keeps Leeway and Heads up first, even when a saved layout hid them or put them last', async () => {
    const buried = layout([
      { type: 'net-worth', size: 'half' },
      { type: 'alerts', visible: false },
      { type: 'leeway', visible: false },
    ])
    serveHome(buried, somethingNeedsYou)
    renderHome(buried)
    await screen.findByText('Everyday is overdrawn by $42.10.')
    await waitFor(() => expect(shownCards()).toEqual(['Your leeway', 'Heads up', 'Net worth']))
  })

  it('still loads a saved layout naming a card this build no longer draws', async () => {
    forgetWidgets('summary')
    const old = layout([{ type: 'leeway' }, { type: 'summary' }, { type: 'pace', size: 'half' }])
    serveHome(old)
    renderHome(old)
    await waitFor(() => expect(shownCards()).toEqual(['Your leeway', 'Spending pace']))
  })

  it('is always now: it reads the current period, with no arrows to step back', async () => {
    const server = serveHome()
    renderHome()
    await screen.findByRole('region', { name: 'Your leeway' })
    expect(screen.queryByRole('button', { name: 'Previous period' })).not.toBeInTheDocument()
    expect(server.actions('get_budget')).toEqual([{ offset: 0 }])
    await waitFor(() => expect(server.actions('get_spending_pace')).toEqual([{ offset: 0 }]))
  })

  it('names the screen for a screen reader, though Leeway leads what is seen', async () => {
    serveHome()
    renderHome()
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
  })

  it('shows loading until the budget arrives', async () => {
    serveHome()
    renderHome()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByRole('region', { name: 'Your leeway' })).toBeInTheDocument()
  })

  it('shows why the budget could not load', async () => {
    const unavailable = () =>
      Response.json({ error: 'internal', message: 'Budget is unavailable' }, { status: 500 })
    serveHome(settings, {}, { '/api/actions/get_budget': unavailable })
    renderHome()
    expect(await screen.findByRole('alert')).toHaveTextContent('Budget is unavailable')
    expect(shownCards()).toEqual([])
  })
})

describe('Ask Leeway on Home', () => {
  it("is the frame's button alone, with no Ask link on the page itself", async () => {
    serveHome(settings, { get_chat_status: () => ({ available: true }) })
    renderHome()
    expect(await screen.findByRole('button', { name: 'Ask Leeway' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: /^Ask Leeway/ })).toHaveLength(1)
  })
})
