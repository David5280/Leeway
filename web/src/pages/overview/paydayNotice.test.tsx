// The payday notice on the dashboard: a card for the few days after payday
// that opens Payday, and nothing otherwise.

import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Playbook } from '../../api/client'
import { failing, fakeServer, renderSignedIn } from '../../test/fake'
import { OVER_BUDGET, playbookOf } from '../../test/playbook'
import { PaydayNotice } from './PaydayNotice'

afterEach(() => vi.unstubAllGlobals())

function show(playbook: Playbook) {
  fakeServer({ get_payday_playbook: () => playbook })
  return renderSignedIn(<PaydayNotice />)
}

/** Lets the playbook's read settle before checking that nothing was drawn. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('PaydayNotice', () => {
  it('greets a new paycheck with what was left and opens Payday', async () => {
    show(playbookOf({ justPaid: true }))
    const card = await screen.findByRole('region', { name: 'Payday' })
    expect(card).toHaveTextContent(
      "It's paydayYou had $44 left from your last paycheck. See what this one covers.",
    )
    expect(screen.getByText('$44')).toHaveClass('money-in')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/plan/payday')
  })

  it('leaves out the leftover when spending ran over, or no period was closed', async () => {
    show(playbookOf({ budgets: OVER_BUDGET, justPaid: true }))
    expect(await screen.findByRole('region', { name: 'Payday' })).toHaveTextContent(
      "It's paydaySee what this one covers.",
    )
  })

  it('shows nothing once the few days after payday have passed', async () => {
    const { container } = show(playbookOf({ justPaid: false }))
    await settle()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing when the playbook cannot be read', async () => {
    fakeServer({}, { '/api/actions/get_payday_playbook': failing('Nope', 500) })
    const { container } = renderSignedIn(<PaydayNotice />)
    await settle()
    expect(container).toBeEmptyDOMElement()
  })
})
