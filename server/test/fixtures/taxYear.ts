// A made-up tax year and the helpers that build one, shared by the tax
// export's database tests.

import type { AppContext } from '../../src/context.js'
import { actionCaller } from '../actionCaller.js'
import { insertBankAccount, insertBankTransaction } from '../helpers.js'

export interface Extra {
  detailed?: string
  merchantName?: string
  pending?: boolean
  /** How it was filed, when not by the bank's category. */
  source?: 'manual' | 'rule'
}

export const CARD_PAYMENT = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'

/** The helpers, bound to a test context read lazily, as test files make it in beforeAll. */
export function taxYear(getContext: () => AppContext) {
  const { call } = actionCaller(getContext)
  const db = () => getContext().db

  /** A new category's id. */
  async function category(
    name: string,
    kind: 'expense' | 'income' | 'transfer' = 'expense',
    groupName?: string,
  ) {
    return (await call('create_category', { name, kind, group: groupName })).id
  }

  /** A bank transaction on an account, filed under a category (or none). */
  async function transaction(
    account: string,
    date: string,
    name: string,
    cents: number,
    categoryId: string | null,
    extra: Extra = {},
  ) {
    const id = await insertBankTransaction(db(), account, {
      date,
      name,
      amountCents: cents,
      detailed: extra.detailed ?? null,
      merchantName: extra.merchantName ?? null,
      pending: extra.pending,
    })
    await db().query(
      'UPDATE transactions SET category_id = $1, category_source = $2 WHERE id = $3',
      [categoryId, extra.source ?? null, id],
    )
    return id
  }

  /** A checking account and a hidden card. */
  async function checkingAndHiddenCard() {
    const checking = (await insertBankAccount(db(), { name: 'Checking' })).accountId
    const card = (await insertBankAccount(db(), { name: 'Card', type: 'credit', hidden: true }))
      .accountId
    return { checking, card }
  }

  /**
   * A made-up year of money: pay (some into an old bank since hidden),
   * interest, dividends, a friend paying through Zelle, money moved in,
   * spending on a hidden card, and money in and out with no category. Then
   * what never counts: moves between own accounts (hidden ones included), an
   * excluded line, a pending one and the years either side.
   */
  async function seed() {
    const income = await category('Income', 'income')
    const fromPeople = await category('Received from people', 'income')
    const health = await category('Health', 'expense', 'Health and fitness')
    const groceries = await category('Groceries')
    const debt = await category('Debt payments')
    const namedLikeNone = await category('Not categorized')
    const moves = await category('Transfers', 'transfer')
    const everyday = (await insertBankAccount(db(), { name: 'Everyday' })).accountId
    const savings = (await insertBankAccount(db(), { name: 'Savings' })).accountId
    const oldBank = (await insertBankAccount(db(), { name: 'Old bank', hidden: true })).accountId
    const oldCard = (
      await insertBankAccount(db(), { name: 'Old card', type: 'credit', hidden: true })
    ).accountId
    const tx = (
      date: string,
      name: string,
      cents: number,
      categoryId: string | null,
      extra: Extra & { account?: string } = {},
    ) => transaction(extra.account ?? everyday, date, name, cents, categoryId, extra)
    const acme = { merchantName: 'Acme Corp', detailed: 'INCOME_WAGES' }
    await tx('2026-01-01', 'ACME PAYROLL', -300000, income, acme)
    await tx('2026-02-15', 'ACME PAYROLL', -300000, income, { ...acme, account: oldBank })
    await tx('2026-03-01', 'SIDE GIG LLC', -50000, income, { merchantName: 'Side Gig' })
    await tx('2026-03-31', 'INTEREST PAID', -1500, income, { detailed: 'INCOME_INTEREST_EARNED' })
    await tx('2026-06-30', 'DIVIDEND', -2500, income, { detailed: 'INCOME_DIVIDENDS' })
    await tx('2026-04-02', 'Zelle from Sam', -5000, income)
    await tx('2026-04-03', 'From outside', -7000, fromPeople, {
      detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
    })
    await tx('2026-05-01', 'Clawback', 1000, income, { merchantName: 'Clawback Co' })
    await tx('2026-04-10', 'CVS PHARMACY', 12000, health)
    await tx('2026-04-11', 'Whole Foods, Market', 8000, groceries, {
      merchantName: 'Whole Foods, Market',
    })
    const refund = await tx('2026-04-12', 'Whole Foods refund', -1000, groceries)
    await tx('2026-05-20', 'Old card spend', 6000, groceries, { account: oldCard })
    await tx('2026-12-31', 'Old bank groceries', 9000, groceries, { account: oldBank })
    await tx('2026-04-13', 'Corner store', 3000, null)
    await tx('2026-04-14', 'Mystery deposit', -20000, null)
    await tx('2026-04-15', 'Lunch', 2500, namedLikeNone)

    // None of these count.
    await tx('2026-05-01', 'To savings', 50000, moves)
    await tx('2026-05-01', 'From checking', -50000, moves, { account: savings })
    await tx('2026-05-05', 'To old bank', 40000, moves)
    await tx('2026-05-05', 'From everyday', -40000, moves, { account: oldBank })
    // Paying the hidden card: filed as spending, since budgets leave the card out, yet a move here.
    await tx('2026-06-01', 'CARD PAYMENT', 25000, debt, { detailed: CARD_PAYMENT })
    await tx('2026-06-02', 'PAYMENT RECEIVED', -25000, null, {
      account: oldCard,
      detailed: CARD_PAYMENT,
    })
    // Two unfiled legs of one move between own accounts.
    await tx('2026-07-01', 'Withdrawal', 15000, null)
    await tx('2026-07-02', 'Deposit', -15000, null, { account: savings })
    const excluded = await tx('2026-05-02', 'Reimbursed lunch', 4000, groceries)
    await db().query('UPDATE transactions SET excluded = true WHERE id = $1', [excluded])
    await tx('2026-05-04', 'Pending', 9000, groceries, { pending: true })
    await tx('2025-12-31', 'Last year', 9000, groceries)
    await tx('2027-01-01', 'Next year', 9000, groceries)
    await db().query(`UPDATE transactions SET note = '=HYPERLINK("x")' WHERE id = $1`, [refund])
    return { namedLikeNone }
  }

  return { category, transaction, checkingAndHiddenCard, seed }
}
