// Money leaks among the account alerts (a charge made twice, a price gone
// up): amber, labelled, opening that merchant's charges on the account, and
// hidden from home one charge at a time.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { duplicateAlert, priceRiseAlert } from '../../../server/src/domain/leaks/leakAlerts'
import type { AccountAlert } from '../api/client'
import { AccountHealth } from '../pages/overview/AccountHealth'
import { fakeServer, renderSignedIn } from '../test/fake'
import { homeAlertHandlers } from '../test/homeAlerts'
import { ALERT_LABELS, alertKey, alertPath, alertTone } from './AccountAlerts'

afterEach(() => vi.unstubAllGlobals())

const format = {
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  date: (date: string) => date.slice(5),
}

/** A posted charge on the checking account. */
const charge = (id: string, date: string, amountCents: number) => ({
  id,
  accountId: 'chk',
  date,
  name: 'NETFLIX.COM',
  merchantName: 'Netflix',
  amountCents,
})

const twice: AccountAlert = duplicateAlert(
  {
    accountId: 'chk',
    charges: [
      charge('11111111-1111-4111-8111-111111111111', '2026-11-03', 1549),
      charge('22222222-2222-4222-8222-222222222222', '2026-11-04', 1549),
    ],
  },
  { accountName: 'Everyday', merchant: 'Netflix & Co' },
  format,
)

const rise: AccountAlert = priceRiseAlert(
  {
    name: 'Spotify',
    charge: charge('33333333-3333-4333-8333-333333333333', '2026-11-12', 1199),
    previousCents: 1099,
  },
  'Everyday',
  format,
)

describe('a leak alert', () => {
  it('opens the merchant’s charges on that account', () => {
    expect(alertPath(twice)).toBe(
      '/transactions?account=chk&range=all&merchant=22222222-2222-4222-8222-222222222222&merchantName=Netflix+%26+Co',
    )
    expect(alertPath(rise)).toBe(
      '/transactions?account=chk&range=all&merchant=33333333-3333-4333-8333-333333333333&merchantName=Spotify',
    )
  })

  it('is a warning, never red, with a word for its kind', () => {
    expect(alertTone(twice)).toBe('warn')
    expect(alertTone(rise)).toBe('warn')
    expect(ALERT_LABELS.duplicate_charge).toBe('Twice')
    expect(ALERT_LABELS.price_rise).toBe('Price')
  })

  it('is keyed by its charge, so two leaks on one account stay apart', () => {
    const other = { ...twice, charge: { ...twice.charge!, id: 'another' } }
    expect(alertKey(twice)).not.toBe(alertKey(other))
  })
})

describe('leaks on the home banner', () => {
  const banner = () => screen.getByRole('region', { name: 'Account alerts' })

  it('lists both in amber, and hides one by its charge', async () => {
    const server = fakeServer(homeAlertHandlers([twice, rise]).handlers)
    renderSignedIn(<AccountHealth />)
    const link = await screen.findByRole('link', { name: /Netflix & Co charged \$15\.49 twice/ })
    expect(link).toHaveAttribute('href', alertPath(twice))
    expect(banner()).toHaveClass('warn-card')

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Hide from home: Spotify went up to $11.99, from $10.99.',
      }),
    )
    await waitFor(() => expect(screen.queryByText(/Spotify went up/)).not.toBeInTheDocument())
    expect(server.actions('hide_home_alert')).toEqual([
      { kind: 'price_rise', accountId: 'chk', chargeId: '33333333-3333-4333-8333-333333333333' },
    ])
    expect(screen.getByText(/Netflix & Co charged/)).toBeInTheDocument()
  })
})
