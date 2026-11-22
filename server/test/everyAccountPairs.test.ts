// Moves between own accounts across every account, hidden cards and loans
// too: the pairing rounds on their own, then as read from the database.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import {
  filedElsewhereOk,
  firmLeg,
  loadEveryAccountPairs,
  looseLeg,
  pairEveryAccount,
  paysCard,
} from '../src/domain/everyAccountPairs.js'
import { loadTransferPairs, type StoredLeg } from '../src/domain/transferPairs.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const CARD_PAYMENT = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'

/** A made-up leg on a checking account, unfiled and silent unless told otherwise. */
function leg(fields: Partial<StoredLeg> & Pick<StoredLeg, 'id' | 'amountCents'>): StoredLeg {
  return {
    accountId: 'checking',
    date: '2026-06-03',
    name: 'DEPOSIT',
    merchantName: null,
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
    accountType: 'depository',
    categoryKind: null,
    filedElsewhere: false,
    hiddenDebt: false,
    ...fields,
  }
}

/** Paying a hidden card: the checking side filed as spending, the card side as a transfer. */
const cardPayment = leg({
  id: 'payment',
  amountCents: 50000,
  name: 'CARD AUTOPAY',
  providerCategoryDetailed: CARD_PAYMENT,
  categoryKind: 'expense',
})
const cardSide = leg({
  id: 'card',
  accountId: 'card',
  accountType: 'credit',
  amountCents: -50000,
  date: '2026-06-05',
  name: 'AUTOMATIC PAYMENT',
  categoryKind: 'transfer',
  hiddenDebt: true,
})

describe('pairing every account', () => {
  it('pairs legs that both say they are transfers before a silent one with a closer date', () => {
    const deposit = leg({ id: 'deposit', accountId: 'savings', amountCents: -50000 })
    const pairs = pairEveryAccount([cardPayment, cardSide, deposit])
    expect(pairs.get('payment')?.id).toBe('card')
    expect(pairs.has('deposit')).toBe(false)
  })

  it('still pairs two silent unfiled legs of one move in the second round', () => {
    const out = leg({ id: 'out', amountCents: 15000, name: 'WITHDRAWAL' })
    const into = leg({ id: 'in', accountId: 'savings', amountCents: -15000 })
    expect(pairEveryAccount([out, into]).get('out')?.id).toBe('in')
  })

  it('pairs a card payment filed as something else only with a hidden card', () => {
    const byHand = { ...cardPayment, filedElsewhere: true }
    expect(pairEveryAccount([byHand, cardSide]).get('payment')?.id).toBe('card')
    expect(pairEveryAccount([byHand, { ...cardSide, hiddenDebt: false }]).size).toBe(0)
  })

  it('lets a leg filed as something else pair only as a payment to a hidden credit card', () => {
    const byHand = (fields: Partial<StoredLeg>) =>
      leg({ id: 'e', amountCents: 1, filedElsewhere: true, ...fields })
    const hiddenCard = leg({ id: 'h', amountCents: -1, accountType: 'credit', hiddenDebt: true })
    const hiddenLoan = { ...hiddenCard, accountType: 'loan' }
    const plain = leg({ id: 'p', amountCents: -1 })
    const byCode = byHand({ providerCategoryDetailed: CARD_PAYMENT })
    const byWords = byHand({ name: 'CHASE CREDIT CRD AUTOPAY' })
    expect(filedElsewhereOk(byCode, hiddenCard)).toBe(true)
    expect(filedElsewhereOk(hiddenCard, byWords)).toBe(true)
    // A loan has no purchases to stand in for the payment.
    expect(filedElsewhereOk(byCode, hiddenLoan)).toBe(false)
    expect(filedElsewhereOk(byCode, plain)).toBe(false)
    expect(filedElsewhereOk(plain, byCode)).toBe(false)
    // A transfer code alone could be rent, paid while the card was paid from elsewhere.
    const rent = byHand({
      name: 'ONLINE TRANSFER TO LANDLORD',
      providerCategoryDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
    })
    expect(filedElsewhereOk(rent, hiddenCard)).toBe(false)
    expect(filedElsewhereOk(plain, hiddenCard)).toBe(true)
  })

  it('reads card payment words in the merchant name too', () => {
    expect(paysCard(leg({ id: 'm', amountCents: 1, merchantName: 'Citi Card Payment' }))).toBe(true)
    expect(paysCard(leg({ id: 'n', amountCents: 1, name: 'XCEL ENERGY AUTOPAY' }))).toBe(false)
  })

  it('reads e-payments, mobile payments and an ACH payment only beside a card issuer', () => {
    const says = (name: string) => paysCard(leg({ id: 'w', amountCents: 1, name }))
    expect(says('CITI AUTOPAY EPAYMENT')).toBe(true)
    expect(says('DISCOVER E-PAYMENT')).toBe(true)
    expect(says('BARCLAYCARD MOBILE PMT')).toBe(true)
    expect(says('CHASE ACH PMT')).toBe(true)
    expect(says('AMERICAN EXPRESS ACH PMT')).toBe(true)
    expect(says('CITY WATER ACH PMT')).toBe(false)
  })

  it('reads a leg in round one as firm when it says transfer or is filed as one', () => {
    expect(firmLeg('transfer', leg({ id: 'a', amountCents: 1 }))).toBe(true)
    expect(firmLeg('none', leg({ id: 'b', amountCents: 1, categoryKind: 'transfer' }))).toBe(true)
    expect(firmLeg('none', leg({ id: 'c', amountCents: 1 }))).toBe(false)
  })

  it('lets a silent leg pair in round two only when nobody filed it as spending or income', () => {
    const silent = (categoryKind: StoredLeg['categoryKind']) =>
      looseLeg('none', leg({ id: 'x', amountCents: 1, categoryKind }))
    expect(silent(null)).toBe(true)
    expect(silent('transfer')).toBe(true)
    expect(silent('expense')).toBe(false)
    expect(silent('income')).toBe(false)
    expect(looseLeg('transfer', leg({ id: 'y', amountCents: 1, categoryKind: 'income' }))).toBe(
      true,
    )
  })
})

describe('reading every account for pairs', () => {
  let ctx: AppContext
  const { call } = actionCaller(() => ctx)

  beforeAll(async () => {
    ctx = await createTestContext()
  })
  afterAll(async () => {
    await ctx.db.end()
  })
  beforeEach(async () => {
    await resetData(ctx.db)
  })

  /** A transaction filed under a category, with how it was filed. */
  async function filed(
    account: string,
    fields: { date: string; name: string; cents: number; detailed?: string },
    categoryId: string | null,
    source: 'manual' | 'rule' | null = null,
  ) {
    const id = await insertBankTransaction(ctx.db, account, {
      date: fields.date,
      name: fields.name,
      amountCents: fields.cents,
      detailed: fields.detailed ?? null,
    })
    await ctx.db.query(
      'UPDATE transactions SET category_id = $1, category_source = $2 WHERE id = $3',
      [categoryId, source, id],
    )
    return id
  }

  /** Checking, a hidden card and a hidden loan, with a spending and a transfer category. */
  async function accounts() {
    const debt = (await call('create_category', { name: 'Debt payments' })).id
    const moves = (await call('create_category', { name: 'Transfers', kind: 'transfer' })).id
    const checking = (await insertBankAccount(ctx.db, { name: 'Checking' })).accountId
    const card = (await insertBankAccount(ctx.db, { name: 'Card', type: 'credit', hidden: true }))
      .accountId
    const loan = (await insertBankAccount(ctx.db, { name: 'Car loan', type: 'loan', hidden: true }))
      .accountId
    return { debt, moves, checking, card, loan }
  }

  it('pairs a payment to a hidden card the owner filed as spending by hand', async () => {
    const { debt, moves, checking, card } = await accounts()
    const payment = await filed(
      checking,
      {
        date: '2026-06-01',
        name: 'CHASE CREDIT CRD AUTOPAY',
        cents: 50000,
        detailed: CARD_PAYMENT,
      },
      debt,
      'manual',
    )
    const cardLeg = await filed(
      card,
      { date: '2026-06-02', name: 'AUTOMATIC PAYMENT', cents: -50000 },
      moves,
    )
    const pairs = await loadEveryAccountPairs(ctx.db, '2026-01-01', '2026-12-31')
    expect(pairs.get(payment)?.id).toBe(cardLeg)
    // Budgets leave the hidden card out, so there the payment stays spending.
    expect((await loadTransferPairs(ctx.db, '2026-01-01', '2026-12-31')).size).toBe(0)
  })

  it('pairs a payment to a hidden card that a rule files as spending', async () => {
    const { debt, moves, checking, card } = await accounts()
    await call('create_rule', { pattern: 'chase credit', field: 'description', categoryId: debt })
    const payment = await filed(
      checking,
      {
        date: '2026-06-01',
        name: 'CHASE CREDIT CRD AUTOPAY',
        cents: 50000,
        detailed: CARD_PAYMENT,
      },
      debt,
      'rule',
    )
    await filed(card, { date: '2026-06-02', name: 'AUTOMATIC PAYMENT', cents: -50000 }, moves)
    expect((await loadEveryAccountPairs(ctx.db, '2026-01-01', '2026-12-31')).has(payment)).toBe(
      true,
    )
  })

  it('never pairs a payment filed as spending with a hidden loan, which has no purchases', async () => {
    const { debt, moves, checking, loan } = await accounts()
    await filed(
      checking,
      {
        date: '2026-08-01',
        name: 'TRANSFER TO CAR LOAN',
        cents: 30000,
        detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
      },
      debt,
      'manual',
    )
    await filed(loan, { date: '2026-08-02', name: 'PAYMENT', cents: -30000 }, moves)
    expect((await loadEveryAccountPairs(ctx.db, '2026-01-01', '2026-12-31')).size).toBe(0)
  })

  it('pairs a card payment across the new year, from either year', async () => {
    const { moves, checking, card } = await accounts()
    const payment = await filed(
      checking,
      { date: '2026-12-31', name: 'CARD AUTOPAY', cents: 20000, detailed: CARD_PAYMENT },
      null,
    )
    const cardLeg = await filed(
      card,
      { date: '2027-01-02', name: 'AUTOMATIC PAYMENT', cents: -20000 },
      moves,
    )
    expect((await loadEveryAccountPairs(ctx.db, '2026-01-01', '2026-12-31')).has(payment)).toBe(
      true,
    )
    expect((await loadEveryAccountPairs(ctx.db, '2027-01-01', '2027-12-31')).has(cardLeg)).toBe(
      true,
    )
  })
})
