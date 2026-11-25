// The pages a tap deeper from Wealth that this tab added: How much you save,
// Things you own and owe, and Compare accounts. Each renders under its own
// heading with a way back to Wealth; what each card holds is tested beside
// the card. Also the debts page's empty states, which offer the next step.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paths, SCREEN_ROUTES } from '../routes'
import { card, everyAccount, server as accountsServer } from '../test/accounts'
import { renderSignedIn } from '../test/fake'
import { month, totalsOf } from '../test/months'
import { planServer, renderPlanning } from '../test/planning'
import { CompareAccountsPage } from './CompareAccounts'

afterEach(() => vi.unstubAllGlobals())

/** A usual month of saving a tenth of pay, and the money in and out behind it. */
const saving = {
  get_savings_rates: () => ({
    months: ['2026-09-01', '2026-10-01'].map((start) => ({
      start,
      current: false,
      percent: 10,
      savedCents: 40000,
      payCents: 400000,
    })),
    targetPercent: null,
    note: 'Counts transfers your bank shows.',
    payEstimated: false,
  }),
  get_monthly_totals: () =>
    totalsOf([month('2026-09-01', 400000, 300000), month('2026-10-01', 400000, 320000)]),
}

/** The way back to Wealth at the top of a page, and that it lands there. */
async function goesBackToWealth() {
  const back = screen.getByRole('link', { name: 'Wealth', current: false })
  expect(back).toHaveAttribute('href', '/wealth')
  await userEvent.click(back)
  expect(await screen.findByRole('heading', { level: 1, name: 'Wealth' })).toBeInTheDocument()
}

describe('How much you save', () => {
  it('leads with the savings rate, then money in and out by month', async () => {
    planServer({ ...saving, list_accounts: () => [], get_net_worth: () => ({ history: [] }) })
    renderPlanning(paths.savings())
    expect(screen.getByRole('heading', { level: 1, name: 'How much you save' })).toBeVisible()
    // The card is drawn anew once the rates arrive, so it is found again after.
    const rateCard = () => screen.getByRole('region', { name: 'Savings rate' })
    await waitFor(() => expect(rateCard()).toHaveTextContent('10%of pay, in a usual month'))
    const rate = rateCard()
    const flows = await screen.findByRole('region', { name: 'Money in and out' })
    expect(rate.compareDocumentPosition(flows)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // Never a verdict on the rate: it leaves out some money taken from pay.
    expect(rate).not.toHaveTextContent(/low|too little|not enough/i)
    await goesBackToWealth()
  })
})

describe('Things you own and owe', () => {
  it('holds what is entered by hand, under its own heading', async () => {
    planServer({ list_accounts: () => [], get_net_worth: () => ({ history: [] }) })
    renderPlanning(paths.owned())
    expect(screen.getByRole('heading', { level: 1, name: 'Things you own and owe' })).toBeVisible()
    const card = await screen.findByRole('region', { name: 'Entered by you' })
    expect(within(card).getByRole('button', { name: 'Add' })).toBeInTheDocument()
    await goesBackToWealth()
  })
})

describe('Compare accounts', () => {
  it('offers every account to tick, under its own heading', async () => {
    accountsServer()
    renderSignedIn(
      <Routes>
        <Route path={SCREEN_ROUTES.compareAccounts} element={<CompareAccountsPage />} />
        <Route path={SCREEN_ROUTES.wealth} element={<h1>Wealth</h1>} />
      </Routes>,
      { route: paths.compareAccounts() },
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Compare accounts' })).toBeVisible()
    expect(await screen.findAllByRole('checkbox')).toHaveLength(everyAccount.length)
    await goesBackToWealth()
  })
})

describe('Debts with nothing to pay off', () => {
  it('says so plainly when no card or loan has a balance', async () => {
    planServer({ list_accounts: () => [{ ...card, balanceCents: 0 }] })
    renderPlanning(paths.debts())
    expect(await screen.findByRole('region', { name: 'Debts' })).toHaveTextContent(
      'No credit cards or loans with a balance, so nothing to pay off.',
    )
  })

  it('offers to connect a bank when there are no accounts yet', async () => {
    planServer({ list_accounts: () => [] })
    renderPlanning(paths.debts())
    const empty = await screen.findByRole('region', { name: 'Debts' })
    expect(within(empty).getByRole('link', { name: 'Connect a bank' })).toHaveAttribute(
      'href',
      '/settings/banks',
    )
  })
})
