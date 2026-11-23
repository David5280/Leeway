// A bill's amount that cannot be read is named, and the bill is not saved.

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderSignedIn } from '../../test/fake'
import { TODAY } from '../../test/planning'
import { BillForm, billFields } from './BillForm'

function renderForm() {
  const onSubmit = vi.fn()
  renderSignedIn(
    <BillForm
      initial={billFields({ name: 'Water', amountCents: 4500 }, TODAY)}
      categories={[]}
      busy={false}
      error={null}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  )
  return { onSubmit, user: userEvent.setup() }
}

describe("a bill's amount", () => {
  it.each(['45OO', '2MM', '5 mil', '99 ct', '1.234'])(
    'names %j as unreadable and keeps Add bill off',
    async (typed) => {
      const { onSubmit, user } = renderForm()
      const amount = screen.getByRole('textbox', { name: 'Amount' })
      await user.clear(amount)
      await user.type(amount, `${typed}{Enter}`)
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read that amount.")
      expect(screen.getByRole('button', { name: 'Add bill' })).toBeDisabled()
      expect(onSubmit).not.toHaveBeenCalled()
    },
  )

  it('names a negative amount, "-45", and keeps Add bill off', async () => {
    const { onSubmit, user } = renderForm()
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '-45{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent("The amount can't be negative.")
    expect(screen.getByRole('button', { name: 'Add bill' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('adds the bill once the amount reads', async () => {
    const { onSubmit, user } = renderForm()
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '1.234,50')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add bill' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 123450 }))
  })
})
