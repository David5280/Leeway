import { describe, expect, it } from 'vitest'
import {
  accountAlerts,
  alertCountsLine,
  countAlerts,
  DEFAULT_LOW_BALANCE_CENTS,
  isOverdraftFee,
  lowBalanceThreshold,
  type AlertAccount,
  type FeeCandidate,
} from '../src/domain/accountAlerts.js'
import { kindOf } from '../src/domain/accountKinds.js'

const format = {
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  date: (date: string) => `on ${date}`,
}

/** A Chase checking account with $500 posted and available; its kind follows the bank's type. */
function account(fields: Partial<AlertAccount> = {}): AlertAccount {
  const row: Omit<AlertAccount, 'kind'> = {
    kindChoice: null,
    id: 'acct-1',
    name: 'Everyday',
    institutionName: 'Chase',
    type: 'depository',
    subtype: 'checking',
    balanceCents: 50000,
    availableCents: 50000,
    creditLimitCents: null,
    lowBalanceCents: null,
    ...fields,
  }
  return {
    ...row,
    kind: fields.kind ?? kindOf({ ...row, bankName: row.name }),
  }
}

function charge(fields: Partial<FeeCandidate> = {}): FeeCandidate {
  return {
    accountId: 'acct-1',
    date: '2026-11-10',
    name: 'OVERDRAFT FEE',
    merchantName: null,
    amountCents: 3500,
    categoryDetailed: null,
    ...fields,
  }
}

describe('isOverdraftFee', () => {
  it.each([
    'OVERDRAFT FEE',
    'Overdraft Item Fee',
    'NSF FEE',
    'NSF',
    'Non-Sufficient Funds Fee',
    'NONSUFFICIENT FUNDS',
    'INSUFFICIENT FUNDS FEE',
    'RETURNED ITEM FEE',
    'OD FEE',
    'OVERDRAFT PROTECTION TRANSFER FEE',
  ])('reads "%s" as a fee', (name) => {
    expect(isOverdraftFee(charge({ name }))).toBe(true)
  })

  it.each(['TRANSFER TO SAVINGS', 'MONTHLY SERVICE FEE', 'ATM FEE', 'Coffee'])(
    'does not read "%s" as one',
    (name) => {
      expect(isOverdraftFee(charge({ name }))).toBe(false)
    },
  )

  it('trusts the bank category whatever the words', () => {
    for (const categoryDetailed of ['BANK_FEES_OVERDRAFT_FEES', 'BANK_FEES_INSUFFICIENT_FUNDS']) {
      expect(isOverdraftFee(charge({ name: 'SERVICE CHARGE', categoryDetailed }))).toBe(true)
    }
    expect(
      isOverdraftFee(charge({ name: 'SERVICE CHARGE', categoryDetailed: 'BANK_FEES_ATM_FEES' })),
    ).toBe(false)
  })

  it('reads the merchant name too', () => {
    expect(isOverdraftFee(charge({ name: 'DEBIT', merchantName: 'Overdraft Charge' }))).toBe(true)
  })

  it('skips an overdraft protection transfer, which moves your own money', () => {
    expect(isOverdraftFee(charge({ name: 'OVERDRAFT PROTECTION TRANSFER FROM SAVINGS' }))).toBe(
      false,
    )
  })

  it('never counts a refund of a fee', () => {
    expect(isOverdraftFee(charge({ amountCents: -3500 }))).toBe(false)
    expect(isOverdraftFee(charge({ amountCents: 0 }))).toBe(false)
  })
})

describe('lowBalanceThreshold', () => {
  it('warns checking accounts below the default', () => {
    expect(lowBalanceThreshold(account())).toBe(DEFAULT_LOW_BALANCE_CENTS)
  })

  it('leaves other cash accounts alone until the owner sets an amount', () => {
    expect(lowBalanceThreshold(account({ subtype: 'savings' }))).toBeNull()
    expect(lowBalanceThreshold(account({ subtype: null }))).toBeNull()
    expect(lowBalanceThreshold(account({ subtype: 'savings', lowBalanceCents: 25000 }))).toBe(25000)
  })

  it('follows the kind the owner picked over the bank subtype', () => {
    const marked = account({ subtype: null, kindChoice: 'checking', kind: 'checking' })
    expect(lowBalanceThreshold(marked)).toBe(DEFAULT_LOW_BALANCE_CENTS)
    const moved = account({ subtype: 'checking', kindChoice: 'savings', kind: 'savings' })
    expect(lowBalanceThreshold(moved)).toBeNull()
  })

  it('takes the owner amount over the default, and 0 as off', () => {
    expect(lowBalanceThreshold(account({ lowBalanceCents: 5000 }))).toBe(5000)
    expect(lowBalanceThreshold(account({ lowBalanceCents: 0 }))).toBeNull()
  })

  it('has none for cards, loans and investments', () => {
    for (const type of ['credit', 'loan', 'investment'] as const) {
      expect(lowBalanceThreshold(account({ type, lowBalanceCents: 5000 }))).toBeNull()
    }
  })
})

describe('accountAlerts', () => {
  it('has nothing to say about healthy accounts', () => {
    expect(accountAlerts([account()], [], format)).toEqual([])
  })

  it('flags a negative available balance as overdrawn, by the lower of the two balances', () => {
    const [alert] = accountAlerts(
      [account({ balanceCents: 1200, availableCents: -4210 })],
      [],
      format,
    )
    expect(alert).toEqual({
      kind: 'overdrawn',
      severity: 'urgent',
      accountId: 'acct-1',
      accountName: 'Everyday',
      amountCents: 4210,
      count: 1,
      date: null,
      message: 'Everyday is overdrawn by $42.10.',
      summary: 'Everyday is overdrawn by $42.10.',
    })
  })

  it('flags a negative posted balance when the bank sends no available one', () => {
    const alerts = accountAlerts(
      [account({ balanceCents: -500, availableCents: null, subtype: 'savings' })],
      [],
      format,
    )
    expect(alerts.map((a) => [a.kind, a.amountCents])).toEqual([['overdrawn', 500]])
  })

  it('says nothing about a cash account with no balance at all', () => {
    expect(
      accountAlerts([account({ balanceCents: null, availableCents: null })], [], format),
    ).toEqual([])
  })

  it('warns when the available balance drops below the warning', () => {
    const [alert] = accountAlerts(
      [account({ balanceCents: 9000, availableCents: 3500 })],
      [],
      format,
    )
    expect(alert).toMatchObject({
      kind: 'low_balance',
      severity: 'warning',
      amountCents: 3500,
      message: 'Everyday is down to $35.00, below your $100.00 warning.',
      summary: 'Everyday is down to $35.00.',
    })
  })

  it('uses the posted balance for a low balance when there is no available one', () => {
    const alerts = accountAlerts(
      [account({ balanceCents: 2000, availableCents: null })],
      [],
      format,
    )
    expect(alerts.map((a) => [a.kind, a.amountCents])).toEqual([['low_balance', 2000]])
  })

  it('does not warn at exactly the warning, or when the warning is off', () => {
    expect(accountAlerts([account({ availableCents: 10000 })], [], format)).toEqual([])
    expect(
      accountAlerts([account({ availableCents: 100, lowBalanceCents: 0 })], [], format),
    ).toEqual([])
  })

  it('never calls a card or loan overdrawn: their balance is what is owed', () => {
    const accounts = [
      account({ type: 'credit', balanceCents: 120000, availableCents: 380000 }),
      account({ type: 'loan', balanceCents: 900000, availableCents: null }),
      account({ type: 'investment', balanceCents: -100, availableCents: null }),
    ]
    expect(accountAlerts(accounts, [], format)).toEqual([])
  })

  it('flags a card over its limit', () => {
    const card = account({
      name: 'Sapphire',
      type: 'credit',
      subtype: 'credit card',
      balanceCents: 512000,
      creditLimitCents: 500000,
    })
    const [alert] = accountAlerts([card], [], format)
    expect(alert).toMatchObject({
      kind: 'over_limit',
      severity: 'urgent',
      amountCents: 12000,
      message: 'Sapphire is $120.00 over its $5000.00 limit.',
      summary: 'Sapphire is $120.00 over its limit.',
    })
  })

  it('leaves a card alone at its limit, or with no known limit or balance', () => {
    const cards = [
      account({ type: 'credit', balanceCents: 500000, creditLimitCents: 500000 }),
      account({ type: 'credit', balanceCents: 500000, creditLimitCents: null }),
      account({ type: 'credit', balanceCents: null, creditLimitCents: 500000 }),
    ]
    expect(accountAlerts(cards, [], format)).toEqual([])
  })

  it('totals an account fees, naming the latest date', () => {
    const fees = [
      charge({ date: '2026-11-12' }),
      charge({ date: '2026-11-03', name: 'NSF FEE' }),
      charge({ name: 'Groceries', amountCents: 8000 }),
    ]
    const [alert] = accountAlerts([account()], fees, format)
    expect(alert).toMatchObject({
      kind: 'overdraft_fee',
      severity: 'warning',
      amountCents: 7000,
      count: 2,
      date: '2026-11-12',
      message:
        'Everyday was charged 2 overdraft fees, $70.00 in all, in the last 30 days, most recently on 2026-11-12.',
      summary:
        'Everyday was charged 2 overdraft fees, $70.00 in all, in the last 30 days, most recently on 2026-11-12.',
    })
  })

  it('words a single fee', () => {
    const [alert] = accountAlerts([account()], [charge()], format)
    expect(alert!.message).toBe(
      'Everyday was charged an overdraft fee of $35.00 in the last 30 days, most recently on 2026-11-10.',
    )
  })

  it('ignores fees on accounts that are not listed', () => {
    expect(accountAlerts([account()], [charge({ accountId: 'other' })], format)).toEqual([])
  })

  it('puts the most serious first: overdrawn, over a limit, fees, then low', () => {
    const accounts = [
      account({ id: 'low', name: 'Low', availableCents: 500 }),
      account({ id: 'fees', name: 'Fees' }),
      account({ id: 'card', name: 'Card', type: 'credit', balanceCents: 2, creditLimitCents: 1 }),
      account({ id: 'short', name: 'Short', availableCents: -1 }),
    ]
    const alerts = accountAlerts(accounts, [charge({ accountId: 'fees' })], format)
    expect(alerts.map((a) => a.accountName)).toEqual(['Short', 'Card', 'Fees', 'Low'])
  })

  it('gives an overdrawn account with fees both alerts', () => {
    const alerts = accountAlerts([account({ availableCents: -100 })], [charge()], format)
    expect(alerts.map((a) => a.kind)).toEqual(['overdrawn', 'overdraft_fee'])
  })
})

describe('counting alerts for the log', () => {
  it('counts each kind, and fees by the fee', () => {
    const alerts = accountAlerts(
      [
        account({ id: 'a', availableCents: -100 }),
        account({ id: 'b', availableCents: 500 }),
        account({ id: 'c', type: 'credit', balanceCents: 2, creditLimitCents: 1 }),
      ],
      [charge({ accountId: 'a' }), charge({ accountId: 'a' }), charge({ accountId: 'b' })],
      format,
    )
    expect(countAlerts(alerts)).toEqual({ overdrawn: 1, overLimit: 1, low: 1, fees: 3 })
  })

  it('words the counts with no names or amounts', () => {
    expect(alertCountsLine({ overdrawn: 1, overLimit: 0, low: 0, fees: 1 })).toBe(
      'Alerts: 1 account overdrawn, 0 cards over their limit, 0 low, 1 overdraft fee in the last 30 days',
    )
    expect(alertCountsLine({ overdrawn: 2, overLimit: 1, low: 3, fees: 0 })).toBe(
      'Alerts: 2 accounts overdrawn, 1 card over its limit, 3 low, 0 overdraft fees in the last 30 days',
    )
  })
})
