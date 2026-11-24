import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { budgetFor, category, fakeServer, renderSignedIn, transaction } from '../../test/fake'
import { Transactions } from '../Transactions'

afterEach(() => vi.unstubAllGlobals())

// How the server files these with the starter set: card payments as a
// transfer, Zelle by the direction the money went.
const transfers = category('Transfers', { kind: 'transfer' })
const sent = category('Sent to people')
const received = category('Received from people', { kind: 'income' })
const categories = [sent, received, transfers]

const CARD_PAYMENT = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'

const paymentOut = transaction({
  id: 'pay-out',
  date: '2026-11-03',
  name: 'Payment to Chase card ending in 4321 11/02',
  amountCents: 200000,
  accountId: 'checking',
  accountName: 'Checking',
  categoryId: transfers.id,
  bankCategory: CARD_PAYMENT,
  // Paired by the server with the payment's arrival on the card.
  displayName: 'Checking to Sapphire',
  transfer: { id: 'pay-in', accountId: 'card', accountName: 'Sapphire', date: '2026-11-04' },
})
const paymentIn = transaction({
  id: 'pay-in',
  date: '2026-11-04',
  name: 'Payment Thank You-Mobile',
  amountCents: -200000,
  accountId: 'card',
  accountName: 'Sapphire',
  categoryId: transfers.id,
  bankCategory: CARD_PAYMENT,
  displayName: 'Checking to Sapphire',
  transfer: { id: 'pay-out', accountId: 'checking', accountName: 'Checking', date: '2026-11-03' },
})
const zelleIn = transaction({
  id: 'zelle-in',
  date: '2026-11-07',
  name: 'Zelle payment from JANE DOE BACmmhq0yzbn',
  amountCents: -12500,
  categoryId: received.id,
  bankCategory: 'TRANSFER_IN_ACCOUNT_TRANSFER',
  person: { app: 'Zelle', direction: 'in', counterparty: 'Jane Doe' },
})
const zelleOut = transaction({
  id: 'zelle-out',
  date: '2026-11-06',
  name: 'Zelle payment to JANE DOE JPM99b1c2d3e',
  amountCents: 4000,
  categoryId: sent.id,
  bankCategory: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
  person: { app: 'Zelle', direction: 'out', counterparty: 'Jane Doe' },
})

function renderList(transactions = [zelleIn, zelleOut, paymentIn, paymentOut]) {
  fakeServer({
    get_budget: () => budgetFor(categories, []),
    list_categories: () => categories,
    list_rules: () => [],
    list_accounts: () => [],
    list_transactions: (input) => {
      // A sheet reads its transaction again by account and day.
      const shown = input.accountId
        ? transactions.filter((tx) => tx.accountId === input.accountId && tx.date === input.start)
        : transactions
      return { transactions: shown, total: shown.length }
    },
  })
  return renderSignedIn(<Transactions />, { route: '/spending/activity' })
}

describe('money moving between your own accounts', () => {
  it('names both sides of a card payment by their accounts, and says which side each is', async () => {
    renderList()
    const user = userEvent.setup()
    const sides = await screen.findAllByRole('button', { name: /^Checking to Sapphire, moved/ })
    expect(sides).toHaveLength(2)

    await user.click(sides[0]!)
    const sheet = screen.getByRole('dialog', { name: 'Checking to Sapphire' })
    expect(within(sheet).getByText('Card payment')).toBeInTheDocument()
    expect(within(sheet).getByText('Moved from')).toBeInTheDocument()
    expect(within(sheet).getByText('Checking, Nov 3')).toBeInTheDocument()
  })

  it('shows the payment arriving on the card with no sign and a quiet tone, never as money earned', async () => {
    renderList()
    const amounts = await screen.findAllByText('$2,000.00')
    expect(amounts).toHaveLength(2)
    for (const amount of amounts) expect(amount).toHaveClass('money-muted')
    expect(screen.queryByText('+$2,000.00')).not.toBeInTheDocument()
  })

  it('still marks a lone side of a transfer as a move', async () => {
    renderList([{ ...paymentIn, transfer: null, displayName: 'Card payment' }])
    const row = await screen.findByRole('button', { name: /^Card payment, moved \$2,000\.00/ })
    expect(within(row).getByText('$2,000.00')).toHaveClass('money-muted')
  })
})

describe('money between people', () => {
  it('shows money received from a person as money in, from them', async () => {
    renderList()
    const row = await screen.findByRole('button', { name: /^From Jane Doe, received \$125\.00/ })
    expect(within(row).getByText('+$125.00')).toHaveClass('money-in')
    await userEvent.click(row)
    expect(screen.getByText('Received with Zelle')).toBeInTheDocument()
  })

  it('shows money sent to a person as money out, to them', async () => {
    renderList()
    const row = await screen.findByRole('button', { name: /^To Jane Doe, spent \$40\.00/ })
    expect(within(row).getByText('$40.00')).toHaveClass('money-neutral')
    await userEvent.click(row)
    expect(screen.getByText('Sent with Zelle')).toBeInTheDocument()
  })
})
