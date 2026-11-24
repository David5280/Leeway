// Helpers for the web tests of adding a pension (pages/plan/retirement):
// the Retirement section's server with no pension yet, and the steps from
// pressing Add a pension to the review of a paystub. Nothing reaches a model.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { savePaystubSchema } from '../../../server/src/domain/paystubs/save'
import { account, settingsHandlers } from './fake'
import { chosenFile, cityRead, paystubStatus, reads, savedPaystub } from './paystub'
import { planServer, renderPlanning, retirementOf } from './planning'
import { pension } from './profile'

const READ_ROUTE = '/api/paystubs/read'

/** A plan linked from the bank, which a new pension could be. */
export const STATE_PLAN = account({
  id: '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  name: 'State Plan',
  type: 'investment',
  subtype: 'other',
})

/** A route that gives each reply in turn, then the last one again, as a server that changes. */
export function inTurn(...replies: (() => Response)[]): () => Response {
  let calls = 0
  return () => replies[Math.min(calls++, replies.length - 1)]!()
}

/** list_accounts answering with these accounts, as a route for inTurn. */
export const listing = (accounts: ReturnType<typeof account>[]) => () =>
  Response.json({ result: accounts })

/** Presses Enter it myself, and gives back the form to type a new pension in. */
export async function byHand() {
  const { user, choosing } = await addPension()
  await user.click(await choosing.findByRole('button', { name: 'Enter it myself' }))
  return { user, form: within(await screen.findByRole('form', { name: 'New pension' })) }
}

/** The pension the fake server says it added. */
const ADDED = pension({ payCadence: 'semimonth' }, { accountId: 'pension-new' })

/**
 * The Retirement section's server with no pension yet, able to read a
 * paystub unless told otherwise. save_paystub checks what it is sent with
 * the server's own schema, and adding by hand goes to create_pension.
 */
export function serve({
  status = paystubStatus(),
  read = reads(cityRead()),
  accounts = [],
  routes = {},
}: {
  status?: ReturnType<typeof paystubStatus>
  read?: () => Response
  accounts?: ReturnType<typeof account>[]
  routes?: Record<string, () => Response>
} = {}) {
  return planServer(
    {
      ...settingsHandlers(),
      project_retirement: () => retirementOf({}, { birthYear: 1986 }),
      list_accounts: () => accounts,
      get_paystub: () => status,
      create_pension: () => ADDED,
      save_paystub: (input) => {
        const { paystub, newPension, attachAccountId } = savePaystubSchema.parse(input)
        // A new account takes the name given; an account Leeway has keeps its own.
        let added = null
        if (newPension) added = { ...ADDED, ...newPension }
        if (attachAccountId) added = { ...ADDED, accountId: attachAccountId }
        return {
          paystub: { ...savedPaystub(), ...paystub, pensionAccountId: added?.accountId ?? null },
          pension: added,
          retirementMonthlyContributionCents: null,
        }
      },
    },
    { [READ_ROUTE]: read, ...routes },
  )
}

/** Presses Add a pension, and gives back the way to choose how. */
export async function addPension() {
  const user = userEvent.setup({ applyAccept: false })
  renderPlanning('/wealth/retirement')
  const pensions = within(await screen.findByRole('region', { name: 'Pensions' }))
  await user.click(pensions.getByRole('button', { name: 'Add a pension' }))
  const choosing = within(await screen.findByRole('region', { name: 'Add a pension' }))
  return { user, choosing }
}

/** Chooses the paystub path and a file, and gives back the review. */
export async function fromPaystub() {
  const { user, choosing } = await addPension()
  await user.click(await choosing.findByRole('button', { name: 'Fill it from a paystub' }))
  const importing = within(
    await screen.findByRole('region', { name: 'Add a pension from a paystub' }),
  )
  await user.upload(importing.getByLabelText('Choose a paystub'), chosenFile())
  return { user, importing }
}

export const review = async () =>
  within(await screen.findByRole('form', { name: 'Review the paystub' }))
