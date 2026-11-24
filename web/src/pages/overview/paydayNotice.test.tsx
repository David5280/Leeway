// The payday notice on the dashboard: a card for the few days after payday
// that opens Payday, and nothing otherwise.

import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Playbook } from '../../api/client'
import { failing, fakeServer, renderSignedIn } from '../../test/fake'
import { LAST_PAYDAY, OVER_BUDGET, playbookOf } from '../../test/playbook'
import { PaydayNotice, paydayTitle } from './PaydayNotice'

afterEach(() => vi.unstubAllGlobals())

function show(playbook: Playbook) {
  fakeServer({ get_payday_playbook: () => playbook })
  return renderSignedIn(<PaydayNotice />)
}

/** Lets the playbook's read settle before checking that nothing was drawn. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('PaydayNotice', () => {
  it('greets a new paycheck with what was left and opens Payday', async () => {
    show(playbookOf({ justPaid: true, today: LAST_PAYDAY }))
    const card = await screen.findByRole('region', { name: 'Payday' })
    expect(card).toHaveTextContent(
      "It's paydayYou had $44 left from your last paycheck. See what this one covers.",
    )
    expect(screen.getByText('$44')).toHaveClass('money-in')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/plan/payday')
  })

  it('leaves out the leftover when spending ran over', async () => {
    show(playbookOf({ budgets: OVER_BUDGET, justPaid: true, today: '2026-11-15' }))
    expect(await screen.findByRole('region', { name: 'Payday' })).toHaveTextContent(
      'Payday was FridaySee what this one covers.',
    )
  })

  it('says payday is today only on the day, and when it was after that', () => {
    // The last payday is Friday, Nov 13.
    const title = (today: string) => paydayTitle({ lastPayday: LAST_PAYDAY, today }, 'en-US')
    expect(title('2026-11-13')).toBe("It's payday")
    expect(title('2026-11-14')).toBe('Payday was yesterday')
    expect(title('2026-11-15')).toBe('Payday was Friday')
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
