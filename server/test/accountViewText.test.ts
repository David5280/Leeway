import { describe, expect, it } from 'vitest'
import {
  accountsSummary,
  combineBalances,
  spendingByCategory,
  type AccountsSummaryInput,
  type BalanceAccount,
  type PeriodFlow,
} from '../src/domain/accountViewText.js'

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

function account(fields: Partial<BalanceAccount> = {}): BalanceAccount {
  return {
    name: 'Everyday',
    type: 'depository',
    balanceCents: 100000,
    availableCents: 90000,
    creditLimitCents: null,
    ...fields,
  }
}

function flow(inCents: number, outCents: number): PeriodFlow {
  return { start: '2026-11-01', end: '2026-11-30', inCents, outCents }
}

describe('combineBalances', () => {
  it('adds cash, owed and everything else apart', () => {
    const balances = combineBalances([
      account(),
      account({ name: 'Savings', balanceCents: 50000, availableCents: null }),
      account({ name: 'Card', type: 'credit', balanceCents: 30000, creditLimitCents: 100000 }),
      account({ name: 'Store card', type: 'credit', balanceCents: 5000, creditLimitCents: null }),
      account({ name: 'Car loan', type: 'loan', balanceCents: 800000, availableCents: null }),
      account({ name: 'Brokerage', type: 'investment', balanceCents: 250000 }),
      account({ name: 'New', type: 'other', balanceCents: null }),
    ])
    expect(balances).toEqual({
      cashCents: 150000,
      // Savings sends no available balance, so its posted one counts.
      availableCents: 140000,
      owedCents: 835000,
      creditLimitCents: 100000,
      // Only the card with a known limit says what is left.
      creditLeftCents: 70000,
      otherCents: 250000,
      netCents: 150000 + 250000 - 835000,
      cashAccounts: 2,
      debtAccounts: 3,
      otherAccounts: 2,
    })
  })

  it('knows no credit limit when no card has one', () => {
    const balances = combineBalances([account({ type: 'credit', balanceCents: 100 })])
    expect(balances).toMatchObject({ creditLimitCents: null, creditLeftCents: null })
  })
})

describe('spendingByCategory', () => {
  const categories = [
    { id: 'food', name: 'Food', color: '#111111', kind: 'expense' as const },
    { id: 'fun', name: 'Fun', color: '#222222', kind: 'expense' as const },
    { id: 'pay', name: 'Pay', color: '#333333', kind: 'income' as const },
  ]

  it('lists expense spending and spending with no category, biggest first', () => {
    const spending = spendingByCategory(
      [
        { categoryId: 'fun', amountCents: 2000, count: 1 },
        { categoryId: 'food', amountCents: 9000, count: 3 },
        { categoryId: 'pay', amountCents: -300000, count: 1 },
        { categoryId: null, amountCents: 4000, count: 2 },
      ],
      categories,
    )
    expect(spending).toEqual([
      { categoryId: 'food', name: 'Food', color: '#111111', spentCents: 9000 },
      { categoryId: null, name: 'Needs a category', color: null, spentCents: 4000 },
      { categoryId: 'fun', name: 'Fun', color: '#222222', spentCents: 2000 },
    ])
  })

  it('leaves out refunds that outweigh spending, income filed as expense, and unknown ids', () => {
    const spending = spendingByCategory(
      [
        { categoryId: 'food', amountCents: -500, count: 1 },
        { categoryId: null, amountCents: -100, count: 1 },
        { categoryId: 'pay', amountCents: 700, count: 1 },
        { categoryId: 'gone', amountCents: 700, count: 1 },
      ],
      categories,
    )
    expect(spending).toEqual([])
  })
})

/** An urgent alert as the summary reads it: its severity and its sentence. */
const urgent = (message: string) => ({ severity: 'urgent' as const, message })

function input(fields: Partial<AccountsSummaryInput> = {}): AccountsSummaryInput {
  const accounts = [account()]
  return {
    accounts,
    unshared: [],
    balances: combineBalances(accounts),
    flows: [flow(0, 0), flow(0, 0)],
    spending: [],
    alerts: [],
    periodWord: 'month',
    ...fields,
  }
}

describe('accountsSummary', () => {
  it('says an overdrawn account in words, leading the points, with the amount said once', () => {
    const accounts = [account({ balanceCents: -4210, availableCents: -4210 })]
    const alerts = [urgent('Everyday is overdrawn by $42.10.')]
    expect(
      accountsSummary(input({ accounts, balances: combineBalances(accounts), alerts }), money),
    ).toEqual({
      headline: 'Nothing is available in Everyday.',
      points: ['Everyday is overdrawn by $42.10.'],
    })
  })

  it('says only the urgent alerts, ahead of every other point', () => {
    const alerts = [
      { severity: 'warning' as const, message: 'Everyday is down to $50.' },
      urgent('Card is $200.00 over its $1000.00 limit.'),
    ]
    const summary = accountsSummary(
      input({ alerts, flows: [flow(0, 0), flow(250000, 120000)] }),
      money,
    )
    expect(summary.points).toEqual([
      'Card is $200.00 over its $1000.00 limit.',
      'So far this month, $2500.00 came in and $1200.00 went out.',
    ])
  })

  it('says what one cash account has available', () => {
    expect(accountsSummary(input(), money)).toEqual({
      headline: '$900.00 available in Everyday.',
      points: [],
    })
  })

  it('says what several cash accounts have available', () => {
    const accounts = [account(), account({ name: 'Savings' })]
    const summary = accountsSummary(input({ accounts, balances: combineBalances(accounts) }), money)
    expect(summary.headline).toBe('$1800.00 available across 2 checking and savings accounts.')
  })

  it('says what one or several cards and loans owe', () => {
    const card = [account({ name: 'Card', type: 'credit', balanceCents: 30000 })]
    expect(
      accountsSummary(input({ accounts: card, balances: combineBalances(card) }), money).headline,
    ).toBe('$300.00 owed on Card.')
    const debts = [...card, account({ name: 'Loan', type: 'loan', balanceCents: 70000 })]
    expect(
      accountsSummary(input({ accounts: debts, balances: combineBalances(debts) }), money).headline,
    ).toBe('$1000.00 owed across 2 cards and loans.')
  })

  it('words one card or loan among several kinds of account', () => {
    const accounts = [
      account({ name: 'Card', type: 'credit', balanceCents: 30000 }),
      account({ name: 'House', type: 'property', balanceCents: 4000000 }),
    ]
    expect(
      accountsSummary(input({ accounts, balances: combineBalances(accounts) }), money).headline,
    ).toBe('$300.00 owed across 1 card or loan.')
  })

  it('gives the worth of accounts that are neither cash nor debt', () => {
    const one = [account({ name: 'House', type: 'property', balanceCents: 4000000 })]
    expect(
      accountsSummary(input({ accounts: one, balances: combineBalances(one) }), money).headline,
    ).toBe('$40000.00 in House.')
    const two = [...one, account({ name: 'Brokerage', type: 'investment', balanceCents: 100 })]
    expect(
      accountsSummary(input({ accounts: two, balances: combineBalances(two) }), money).headline,
    ).toBe('$40001.00 in 2 accounts.')
  })

  it('says nothing is there without accounts', () => {
    expect(
      accountsSummary(input({ accounts: [], balances: combineBalances([]) }), money).headline,
    ).toBe('No accounts yet. Connect a bank or add one in Settings.')
  })

  it('adds debt, unused credit, money in and out, and the top category', () => {
    const accounts = [
      account(),
      account({ name: 'Card', type: 'credit', balanceCents: 30000, creditLimitCents: 100000 }),
    ]
    const summary = accountsSummary(
      input({
        accounts,
        balances: combineBalances(accounts),
        flows: [flow(1, 1), flow(300000, 280000), flow(250000, 120000)],
        spending: [
          { categoryId: null, name: 'Needs a category', color: null, spentCents: 90000 },
          { categoryId: 'food', name: 'Food', color: '#111111', spentCents: 40000 },
        ],
      }),
      money,
    )
    expect(summary.points).toEqual([
      '$300.00 is owed on cards and loans.',
      '$700.00 of $1000.00 in credit is unused.',
      'So far this month, $2500.00 came in and $1200.00 went out.',
      'Last month, $3000.00 came in and $2800.00 went out.',
    ])
  })

  it('names the top category when there is room, and skips quiet periods', () => {
    const summary = accountsSummary(
      input({
        flows: [flow(0, 0), flow(0, 0)],
        spending: [{ categoryId: 'food', name: 'Food', color: '#111111', spentCents: 40000 }],
      }),
      money,
    )
    expect(summary.points).toEqual(['The most spending this month went to Food, $400.00.'])
  })

  it('says nothing of unused credit for a card past its limit', () => {
    const card = [account({ type: 'credit', balanceCents: 120000, creditLimitCents: 100000 })]
    expect(
      accountsSummary(input({ accounts: card, balances: combineBalances(card) }), money).points,
    ).toEqual([])
  })

  it('handles a pick with no periods of history', () => {
    expect(accountsSummary(input({ flows: [] }), money).points).toEqual([])
  })
})

describe('accountsSummary with accounts the bank no longer shares', () => {
  const unshared = (name: string, institutionName: string | null = 'Chase') => ({
    name,
    institutionName,
  })
  const none = { accounts: [], balances: combineBalances([]) }

  it('says first that one is left out of the figures', () => {
    const summary = accountsSummary(input({ unshared: [unshared('Old savings')] }), money)
    expect(summary.points[0]).toBe(
      'Old savings is no longer shared from Chase and is left out of these figures.',
    )
  })

  it('counts several left out, whatever their banks', () => {
    const summary = accountsSummary(
      input({ unshared: [unshared('Old savings'), unshared('Old card', null)] }),
      money,
    )
    expect(summary.points[0]).toBe(
      '2 accounts no longer shared from their banks are left out of these figures.',
    )
  })

  it('says there is no balance when only unshared accounts are picked', () => {
    const one = accountsSummary(input({ ...none, unshared: [unshared('Old', null)] }), money)
    expect(one.headline).toBe(
      'Old is no longer shared from its bank, so it has no current balance.',
    )
    expect(one.points).toEqual([])
    const two = accountsSummary(
      input({ ...none, unshared: [unshared('Old'), unshared('Older')] }),
      money,
    )
    expect(two.headline).toBe(
      'These accounts are no longer shared from their banks, so they have no current balances.',
    )
  })
})
