// The payday notice on the dashboard: a card in the first days after a
// paycheck lands, opening Payday, and nothing otherwise.

import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Playbook } from '../../api/client'
import { failing, fakeServer, renderSignedIn } from '../../test/fake'
import { NEEDS, playbookOf, UNDER_BUDGET } from '../../test/playbook'
import { PaydayNotice } from './PaydayNotice'

afterEach(() => vi.unstubAllGlobals())

function show(playbook: Playbook) {
  fakeServer({ get_payday_playbook: () => playbook })
  return renderSignedIn(<PaydayNotice />)
}

describe('PaydayNotice', () => {
  it('says the paycheck landed, with what was left, and opens Payday', async () => {
    show(playbookOf({ budgets: UNDER_BUDGET, needs: NEEDS, justPaid: true }))
    const card = await screen.findByRole('region', { name: 'Payday' })
    expect(card).toHaveTextContent(
      'It is paydayYour paycheck of $2,100 landed. You had $44 left from the last one. See a plan for it.',
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/plan/payday')
  })

  it('leaves out the leftover when there was none', async () => {
    show(playbookOf({ needs: NEEDS, justPaid: true }))
    const card = await screen.findByRole('region', { name: 'Payday' })
    expect(card).not.toHaveTextContent('left from the last one')
  })

  it('shows nothing between paydays, or when the playbook cannot be read', async () => {
    const { container } = show(playbookOf({ needs: NEEDS }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container).toBeEmptyDOMElement()
    fakeServer({}, { '/api/actions/get_payday_playbook': failing('Nope', 500) })
    const failed = renderSignedIn(<PaydayNotice />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(failed.container).toBeEmptyDOMElement()
  })
})
