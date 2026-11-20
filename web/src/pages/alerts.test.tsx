// The account health banner on the dashboard, with a way to hide each alert
// from it, and the Alerts page it leads to, which keeps every alert.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { account, alertsFor, failing, fakeServer, holdRequest, renderSignedIn } from '../test/fake'
import { homeAlertHandlers, homeList } from '../test/homeAlerts'
import { Alerts } from './Alerts'
import { AccountHealth } from './overview/AccountHealth'

afterEach(() => vi.unstubAllGlobals())

const overdrawn = account({ id: 'a', name: 'Everyday', balanceCents: -4210 })
const low = (id: string) =>
  account({ id, name: `Low ${id}`, balanceCents: 2000, subtype: 'checking' })

describe('the account health banner', () => {
  const banner = () => screen.getByRole('region', { name: 'Account alerts' })

  it('shows nothing when every account is fine', async () => {
    const server = fakeServer({ list_home_alerts: () => homeList([]) })
    const { container } = renderSignedIn(<AccountHealth />)
    await waitFor(() => expect(server.actions('list_home_alerts')).toHaveLength(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('puts an overdrawn account first, in red, linking to its page and to every alert', async () => {
    fakeServer({ list_home_alerts: () => homeList(alertsFor([low('b'), overdrawn])) })
    renderSignedIn(<AccountHealth />)
    const link = await screen.findByRole('link', { name: /Everyday is overdrawn by \$42\.10/ })
    expect(link).toHaveAttribute('href', '/accounts?select=a')
    expect(banner()).toHaveClass('over-card')
    expect(within(banner()).getAllByRole('link')[0]).toBe(link)
    expect(within(banner()).getByRole('link', { name: 'See all alerts' })).toHaveAttribute(
      'href',
      '/alerts',
    )
    expect(banner()).toHaveTextContent('From your last bank sync')
  })

  it('is amber when nothing is urgent', async () => {
    fakeServer({ list_home_alerts: () => homeList(alertsFor([low('b')])) })
    renderSignedIn(<AccountHealth />)
    await screen.findByText(/Low b is down to \$20,/)
    expect(banner()).toHaveClass('warn-card')
  })

  it('keeps to three rows and counts the rest', async () => {
    fakeServer({ list_home_alerts: () => homeList(alertsFor(['b', 'c', 'd', 'e', 'f'].map(low))) })
    renderSignedIn(<AccountHealth />)
    await screen.findByText(/Low b/)
    expect(within(banner()).getAllByRole('link')).toHaveLength(4)
    expect(banner()).toHaveTextContent('2 more alerts')
  })

  it('counts a single alert left over', async () => {
    fakeServer({ list_home_alerts: () => homeList(alertsFor(['b', 'c', 'd', 'e'].map(low))) })
    renderSignedIn(<AccountHealth />)
    await screen.findByText(/Low b/)
    expect(banner()).toHaveTextContent('1 more alert')
  })
})

describe('hiding an alert from the banner', () => {
  const banner = () => screen.getByRole('region', { name: 'Account alerts' })
  const hideButtons = () => within(banner()).getAllByRole('button', { name: /^Hide from home: / })

  /** The banner as on the home screen, above the page's heading, with anywhere it might lead. */
  function renderBanner(alerts = alertsFor([overdrawn, low('b')])) {
    const { handlers } = homeAlertHandlers(alerts)
    const server = fakeServer(handlers)
    renderSignedIn(
      <Routes>
        <Route
          path="/"
          element={
            <>
              <AccountHealth />
              <h1>November</h1>
            </>
          }
        />
        <Route path="*" element={<p>Somewhere else</p>} />
      </Routes>,
    )
    return server
  }

  it('names each button by its alert, so two read apart', async () => {
    renderBanner()
    await screen.findByText(/Everyday is overdrawn/)
    expect(hideButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Hide from home: Everyday is overdrawn by $42.10.',
      expect.stringMatching(/^Hide from home: Low b is down to \$20/),
    ])
  })

  it('hides an alert at once, stays home, and moves focus to the next alert', async () => {
    const server = renderBanner()
    await screen.findByText(/Everyday is overdrawn/)
    const release = holdRequest('/api/actions/hide_home_alert')
    await userEvent.click(hideButtons()[0]!)
    // Gone before the server answers, without opening the account.
    await waitFor(() => expect(screen.queryByText(/Everyday is overdrawn/)).not.toBeInTheDocument())
    expect(screen.queryByText('Somewhere else')).not.toBeInTheDocument()
    expect(hideButtons()).toHaveLength(1)
    expect(hideButtons()[0]).toHaveFocus()
    release()
    await waitFor(() => expect(server.actions('list_home_alerts')).toHaveLength(2))
    expect(server.actions('hide_home_alert')).toEqual([{ kind: 'overdrawn', accountId: 'a' }])
    expect(screen.queryByText(/Everyday is overdrawn/)).not.toBeInTheDocument()
  })

  it('goes altogether once its last alert is hidden, leaving focus on the heading below', async () => {
    renderBanner(alertsFor([overdrawn]))
    await screen.findByText(/Everyday is overdrawn/)
    await userEvent.click(hideButtons()[0]!)
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Account alerts' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: 'November' })).toHaveFocus()
  })

  it('puts the alert back when the server refuses, before the list is read again', async () => {
    const { handlers } = homeAlertHandlers(alertsFor([overdrawn]))
    fakeServer(handlers, { '/api/actions/hide_home_alert': failing('Alert not found', 404) })
    renderSignedIn(<AccountHealth />)
    await screen.findByText(/Everyday is overdrawn/)
    // The fresh read never answers, so only the rollback can bring the row back.
    const release = holdRequest('/api/actions/list_home_alerts')
    await userEvent.click(hideButtons()[0]!)
    expect(await screen.findByText(/Everyday is overdrawn/)).toBeInTheDocument()
    release()
  })
})

describe('the Alerts page', () => {
  it('lists every alert and explains what is watched', async () => {
    fakeServer({ list_alerts: () => alertsFor([overdrawn, ...['b', 'c', 'd', 'e'].map(low)]) })
    renderSignedIn(<Alerts />)
    expect(await screen.findByRole('heading', { name: 'Alerts', level: 1 })).toBeInTheDocument()
    const list = screen.getByRole('region', { name: 'Account alerts' })
    expect(await within(list).findAllByRole('link')).toHaveLength(5)
    // Every alert stays here: hiding is for the home screen only.
    expect(within(list).queryByRole('button', { name: 'Hide from home' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'About alerts' })).toHaveTextContent(
      '$100 for checking accounts',
    )
    expect(screen.getByRole('link', { name: 'Settings, then Accounts' })).toHaveAttribute(
      'href',
      '/settings/accounts',
    )
    // Accounts is in the main menu, beside the Overview it came from.
    const menu = screen.getAllByRole('navigation', { name: 'Main' })[0]!
    expect(within(menu).getByRole('link', { name: 'Accounts' })).toHaveAttribute(
      'href',
      '/accounts',
    )
  })

  it('says when all is well', async () => {
    fakeServer({ list_alerts: () => [] })
    renderSignedIn(<Alerts />)
    expect(await screen.findByText(/Every account is fine/)).toBeInTheDocument()
  })

  it('says why alerts could not be read', async () => {
    fakeServer({}, { '/api/actions/list_alerts': failing('Database is down') })
    renderSignedIn(<Alerts />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })
})
