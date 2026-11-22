// Amounts typed for a goal that cannot be read: a target, the amount saved so
// far and money put toward it are named, and never saved as $0 or nothing.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn } from '../../../test/fake'
import { account, goal } from '../../../test/planning'
import { AddMoney } from './Contributions'
import { GoalForm } from './GoalForm'

afterEach(() => vi.unstubAllGlobals())

const UNREADABLE = "Couldn't read that amount."

const savings = account({ id: 'acct-savings', name: 'High yield savings', type: 'depository' })

/** A rainy day fund with $250 saved by hand. */
const rainyDay = goal({ name: 'Rainy day', targetCents: 300000, savedCents: 25000 })

function renderForm() {
  const onSubmit = vi.fn()
  renderSignedIn(
    <GoalForm
      goal={rainyDay}
      kind="savings"
      accounts={[savings]}
      busy={false}
      error={null}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  )
  return { onSubmit, user: userEvent.setup(), save: screen.getByRole('button', { name: 'Save' }) }
}

describe('GoalForm amounts', () => {
  it('refuses "5OO" saved so far rather than reset it to $0', async () => {
    const { onSubmit, user, save } = renderForm()
    const saved = screen.getByRole('textbox', { name: 'Saved so far' })
    await user.clear(saved)
    await user.type(saved, '5OO')
    expect(screen.getByRole('alert')).toHaveTextContent(UNREADABLE)
    expect(save).toBeDisabled()
    await user.type(saved, '{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()

    await user.clear(saved)
    await user.type(saved, '500')
    await user.click(save)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ savedCents: 50000 }))
  })

  it('ignores saved so far once the goal follows an account', async () => {
    const { onSubmit, user, save } = renderForm()
    const saved = screen.getByRole('textbox', { name: 'Saved so far' })
    await user.type(saved, 'O')
    expect(save).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Progress' }), savings.id)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(save)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ accountId: savings.id }))
  })

  it('names a target it cannot read, and keeps Save off until it can', async () => {
    const { onSubmit, user, save } = renderForm()
    const target = screen.getByRole('textbox', { name: 'Target amount' })
    await user.clear(target)
    await user.type(target, '3k')
    expect(screen.getByRole('alert')).toHaveTextContent(UNREADABLE)
    expect(save).toBeDisabled()
    await user.clear(target)
    await user.type(target, '3,000')
    await user.click(save)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetCents: 300000 }))
  })
})

describe('putting money toward a goal', () => {
  const serve = () => fakeServer({ add_to_goal: () => rainyDay })

  it('names an amount it cannot read and adds nothing', async () => {
    const server = serve()
    renderSignedIn(<AddMoney goal={rainyDay} />)
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Amount to add to Rainy day' }), '5O')
    expect(screen.getByRole('alert')).toHaveTextContent(UNREADABLE)
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(server.actions('add_to_goal')).toEqual([])
  })

  it.each([
    ['-50', -5000],
    ['−50', -5000],
    ['(50)', -5000],
  ])('takes %j back out, as %i cents', async (typed, cents) => {
    const server = serve()
    renderSignedIn(<AddMoney goal={rainyDay} />)
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Amount to add to Rainy day' }), typed)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('add_to_goal')).toEqual([{ id: rainyDay.id, amountCents: cents }]),
    )
  })
})
