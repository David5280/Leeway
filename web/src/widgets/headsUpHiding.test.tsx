// Hiding an account alert from Heads up on Home: at once, with focus kept in
// the card, and put back when the server refuses. The Inbox keeps every alert.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  account,
  alertsFor,
  budgetFor,
  failing,
  fakeServer,
  holdRequest,
  renderSignedIn,
} from '../test/fake'
import { homeAlertHandlers } from '../test/homeAlerts'
import { AlertsWidget } from './Alerts'

afterEach(() => vi.unstubAllGlobals())

const overdrawn = account({ id: 'a', name: 'Everyday', balanceCents: -4210 })
const low = account({ id: 'b', name: 'Low b', balanceCents: 2000, subtype: 'checking' })
/** A budget with nothing to say, so Heads up lists only the account alerts. */
const quiet = budgetFor([], [])

const card = () => screen.getByRole('region', { name: 'Heads up' })
const hideButtons = () => within(card()).getAllByRole('button', { name: /^Hide from home: / })

/** Heads up as on Home, above the next heading, with anywhere it might lead. */
function renderHeadsUp(alerts = alertsFor([overdrawn, low])) {
  const { handlers } = homeAlertHandlers(alerts)
  const server = fakeServer({ list_connections: () => [], ...handlers })
  renderSignedIn(
    <Routes>
      <Route
        path="/"
        element={
          <>
            <AlertsWidget budget={quiet} />
            <h2>Cards</h2>
          </>
        }
      />
      <Route path="*" element={<p>Somewhere else</p>} />
    </Routes>,
  )
  return server
}

describe('hiding an alert from Heads up', () => {
  it('names each button by its alert, so two read apart', async () => {
    renderHeadsUp()
    await screen.findByText(/Everyday is overdrawn/)
    expect(hideButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Hide from home: Everyday is overdrawn by $42.10.',
      expect.stringMatching(/^Hide from home: Low b is down to \$20/),
    ])
  })

  it('hides an alert at once, stays home, and moves focus to the next alert', async () => {
    const server = renderHeadsUp()
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
  })

  it('moves focus back to the alert before when the last one is hidden', async () => {
    renderHeadsUp()
    await screen.findByText(/Low b is down/)
    await userEvent.click(hideButtons()[1]!)
    await waitFor(() => expect(screen.queryByText(/Low b is down/)).not.toBeInTheDocument())
    expect(hideButtons()).toHaveLength(1)
    expect(hideButtons()[0]).toHaveFocus()
    expect(hideButtons()[0]).toHaveAccessibleName(/Everyday is overdrawn/)
  })

  it('puts the alert back when the server refuses, before the list is read again', async () => {
    const { handlers } = homeAlertHandlers(alertsFor([overdrawn]))
    fakeServer(
      { list_connections: () => [], ...handlers },
      { '/api/actions/hide_home_alert': failing('Alert not found', 404) },
    )
    renderSignedIn(<AlertsWidget budget={quiet} />)
    await screen.findByText(/Everyday is overdrawn/)
    // The fresh read never answers, so only the rollback can bring the row back.
    const release = holdRequest('/api/actions/list_home_alerts')
    await userEvent.click(hideButtons()[0]!)
    expect(await screen.findByText(/Everyday is overdrawn/)).toBeInTheDocument()
    release()
  })
})
