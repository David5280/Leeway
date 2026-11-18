import { screen } from '@testing-library/react'
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
    list_transactions: () => ({ transactions, total: transactions.length }),
  })
  return renderSignedIn(<Transactions />, { route: '/transactions' })
}

describe('money moving between your own accounts', () => {
  it('labels both sides of a card payment and names the account on the other side', async () => {
    renderList()

    expect(await screen.findByText('Checking · Card payment · to Sapphire')).toBeInTheDocument()
    expect(screen.getByText('Sapphire · Card payment · from Checking')).toBeInTheDocument()
  })

  it('shows the payment arriving on the card in a neutral color, never as money earned', async () => {
    renderList()

    const arrival = await screen.findByText('+$2,000.00')
    expect(arrival).toHaveClass('muted')
    expect(arrival).not.toHaveClass('good')
    expect(screen.getByText('$2,000.00')).toHaveClass('muted')
  })

  it('still labels a lone side of a transfer when its partner is not in view', async () => {
    renderList([paymentIn])

    expect(await screen.findByText('Sapphire · Card payment')).toBeInTheDocument()
  })
})

describe('money between people', () => {
  it('shows money received from a person as money in, from them', async () => {
    renderList()

    expect(await screen.findByText('From Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('Checking · Received with Zelle')).toBeInTheDocument()
    expect(screen.getByText('+$125.00')).toHaveClass('good')
  })

  it('shows money sent to a person as money out, to them', async () => {
    renderList()

    expect(await screen.findByText('To Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('Checking · Sent with Zelle')).toBeInTheDocument()
    expect(screen.getByText('$40.00')).not.toHaveClass('good')
  })
})
