// "Can I afford it?" on Goals: a thing and a price checked by the server's
// own action (no AI), answered in words with its numbers, and a "Save for
// it" that opens a purchase goal filled in from what was typed.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { affordPlan, checkOf } from '../../../../test/afford'
import { failing, type Handlers } from '../../../../test/fake'
import { planServer, renderPlanning } from '../../../../test/planning'
import type { PurchasePlan } from './affordText'

afterEach(() => vi.unstubAllGlobals())

const FITS = 'It fits: you would still have about $139 a day to spend.'
const SHORT = 'It would leave $360 too little for the bills due by Fri, Nov 27.'
const SQUEEZE = 'What you can spend a day would drop from $144 to $24.'

/** Goals with no goals, answering the check with this plan. */
function show(plan: PurchasePlan | (() => Response), extra: Handlers = {}) {
  const server = planServer(
    {
      list_goals: () => [],
      list_accounts: () => [],
      ...(typeof plan === 'function' ? {} : { when_can_i_afford: () => plan }),
      ...extra,
    },
    typeof plan === 'function' ? { '/api/actions/when_can_i_afford': plan } : {},
  )
  renderPlanning('/goals')
  return { server, user: userEvent.setup() }
}

/** Types a thing and a price into the check and asks. */
async function ask(user: ReturnType<typeof userEvent.setup>, name: string, price: string) {
  const form = within(await screen.findByRole('form', { name: 'Can I afford it?' }))
  if (name) await user.type(form.getByRole('textbox', { name: 'What is it?' }), name)
  await user.type(form.getByRole('textbox', { name: 'Price' }), price)
  await user.click(form.getByRole('button', { name: 'Check' }))
}

const answer = () => screen.findByRole('status', { name: 'The answer' })

describe('Can I afford it?', () => {
  it('says yes in words with the numbers, asking the server, not an AI', async () => {
    const { server, user } = show(affordPlan(checkOf(5_000, 'yes', [FITS])))
    await ask(user, 'Headphones', '50')
    const said = await answer()
    expect(said).toHaveTextContent(`Yes. Headphones at $50 fits.${FITS}`)
    expect(within(said).getByText('Yes.')).toHaveClass('good')
    expect(within(said).queryByRole('button', { name: 'Save for it' })).toBeNull()
    expect(server.actions('when_can_i_afford')).toEqual([{ amountCents: 5_000 }])
  })

  it('says not yet, when saving gets there, and starts a goal filled in from it', async () => {
    const { user } = show(affordPlan(checkOf(120_000, 'no', [SHORT])))
    await ask(user, 'Road bike', '1200')
    const said = await answer()
    expect(within(said).getByText('Not yet.')).toHaveClass('over')
    expect(said).toHaveTextContent('Road bike at $1,200 does not fit before payday.')
    expect(said).toHaveTextContent(SHORT)
    // $1,200 at $300 a month is four months, this one counted: saved by the end of February.
    expect(said).toHaveTextContent(
      'Putting aside $300 each month, you could buy it by Feb 28, 2027.',
    )

    await user.click(within(said).getByRole('button', { name: 'Save for it' }))
    const form = within(screen.getByRole('form', { name: 'New purchase' }))
    expect(form.getByRole('textbox', { name: 'What are you saving for?' })).toHaveValue('Road bike')
    expect(form.getByRole('textbox', { name: 'Price' })).toHaveValue('1200')
    expect(form.getByLabelText('Target date')).toHaveValue('2027-02-28')
  })

  it('calls a squeeze tight, and still offers to save for it', async () => {
    const { user } = show(affordPlan(checkOf(30_000, 'tight', [SQUEEZE])))
    await ask(user, '', '300')
    const said = await answer()
    expect(within(said).getByText('Tight.')).toHaveClass('warn')
    expect(said).toHaveTextContent(`$300 fits, but only just.${SQUEEZE}`)
    await user.click(within(said).getByRole('button', { name: 'Save for it' }))
    const form = within(screen.getByRole('form', { name: 'New purchase' }))
    expect(form.getByRole('textbox', { name: 'What are you saving for?' })).toHaveValue('')
    expect(form.getByRole('textbox', { name: 'Price' })).toHaveValue('300')
  })

  it('has no date to give when nothing is over each month, and says a goal is the way', async () => {
    const { user } = show(affordPlan(checkOf(120_000, 'no', [SHORT]), { surplusCents: null }))
    await ask(user, 'Road bike', '1200')
    const said = await answer()
    expect(said).toHaveTextContent(
      'A usual month leaves nothing over after spending and goals yet, so saving for it as a goal is the way there.',
    )
    await user.click(within(said).getByRole('button', { name: 'Save for it' }))
    expect(screen.getByLabelText('Target date')).toHaveValue('')
  })

  it('says a date from pay still being learned is an estimate', async () => {
    const plan = affordPlan(checkOf(120_000, 'no', [SHORT]), { surplusEstimated: true })
    const { user } = show(plan)
    await ask(user, 'Road bike', '1200')
    expect(await answer()).toHaveTextContent(
      'That date is an estimate until pay has come a few more times.',
    )
  })

  it('works with no AI: chat being off changes nothing, and nothing asks it', async () => {
    const { server, user } = show(affordPlan(checkOf(5_000, 'yes', [FITS])), {
      get_chat_status: () => ({ available: false }),
    })
    await ask(user, 'Headphones', '50')
    expect(await answer()).toHaveTextContent('Yes. Headphones at $50 fits.')
    expect(server.calls.some((call) => call.path.startsWith('/api/chat'))).toBe(false)
  })

  it('asks nothing until a price is typed, and shows why a check failed', async () => {
    const { user } = show(failing('The check failed', 500))
    const form = within(await screen.findByRole('form', { name: 'Can I afford it?' }))
    expect(form.getByRole('button', { name: 'Check' })).toBeDisabled()
    await ask(user, 'Road bike', '1200')
    await waitFor(() => expect(screen.getByText('The check failed')).toBeVisible())
    expect(await answer()).toBeEmptyDOMElement()
  })

  it('asks again with the same price after a failure', async () => {
    let calls = 0
    const plan = affordPlan(checkOf(5_000, 'yes', [FITS]))
    const { user } = show(() => {
      calls += 1
      return calls === 1 ? failing('The check failed', 500)() : Response.json({ result: plan })
    })
    await ask(user, 'Headphones', '50')
    await waitFor(() => expect(screen.getByText('The check failed')).toBeVisible())
    await user.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'The answer' })).toHaveTextContent('Yes.'),
    )
    expect(calls).toBe(2)
  })

  it("says it can't tell yet when there is no checking balance, and offers to save", async () => {
    const check = { ...checkOf(5_000, 'yes', [FITS]), cashKnown: false }
    const { user } = show(affordPlan(check))
    await ask(user, 'Headphones', '50')
    const said = await answer()
    expect(within(said).getByText("Can't tell yet.")).toHaveClass('muted')
    expect(said).toHaveTextContent(
      'Headphones at $50 fits the budget, but Leeway has no checking balance to weigh it against yet.',
    )
    await user.click(within(said).getByRole('button', { name: 'Save for it' }))
    expect(screen.getByLabelText('Target date')).toHaveValue('')
  })

  it('clears the answer once its goal is being made, so it cannot be made twice', async () => {
    const { user } = show(affordPlan(checkOf(120_000, 'no', [SHORT])))
    await ask(user, 'Road bike', '1200')
    await user.click(within(await answer()).getByRole('button', { name: 'Save for it' }))
    expect(await answer()).toBeEmptyDOMElement()
  })
})
