// A transaction's amount that cannot be read is named, and nothing is added.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { account, fakeServer, renderSignedIn } from '../../test/fake'
import { AddTransaction } from './AddTransaction'

afterEach(() => vi.unstubAllGlobals())

const cash = account({ id: 'acct-cash', name: 'Cash', manual: true })

function serve() {
  return fakeServer({
    list_accounts: () => [cash],
    create_transaction: (input) => ({ id: 'tx-new', ...input }),
  })
}

async function fillIn(amount: string) {
  renderSignedIn(<AddTransaction categories={[]} onDone={() => {}} />)
  const user = userEvent.setup()
  await screen.findByRole('option', { name: 'Cash' })
  await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Farmers market')
  await user.type(screen.getByRole('textbox', { name: 'Amount' }), amount)
  return user
}

describe("a transaction's amount", () => {
  it.each(['3bn', '1.5mm', '5k', '12.500'])(
    'names %j as unreadable and adds nothing',
    async (typed) => {
      const server = serve()
      const user = await fillIn(typed)
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read that amount.")
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
      await user.type(screen.getByRole('textbox', { name: 'Amount' }), '{Enter}')
      expect(server.actions('create_transaction')).toEqual([])
    },
  )

  it('adds one written with a currency code, as money out', async () => {
    const server = serve()
    const user = await fillIn('12 EUR')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('create_transaction')).toEqual([
        expect.objectContaining({ accountId: cash.id, amountCents: 1200 }),
      ]),
    )
  })
})
