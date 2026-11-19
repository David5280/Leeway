import { describe, expect, it } from 'vitest'
import { account } from '../test/fake'
import { goal } from '../test/planning'
import {
  accountFacts,
  balanceChange,
  combine,
  goalsOn,
  groupAccounts,
  kindIcon,
  utilization,
  utilizationStatus,
} from './accountCards'

const checking = account({ id: 'chk', name: 'Everyday', subtype: 'checking' })
const savings = account({ id: 'sav', name: 'Rainy day', subtype: 'savings' })
const card = account({
  id: 'cc',
  name: 'Travel card',
  type: 'credit',
  subtype: 'credit card',
  balanceCents: 37000,
  creditLimitCents: 100000,
  minimumPaymentCents: 4100,
})
const loan = account({
  id: 'loan',
  name: 'Car loan',
  type: 'loan',
  subtype: 'auto',
  aprPercent: 4.9,
  minimumPaymentCents: 38500,
})
const brokerage = account({
  id: 'inv',
  name: 'Brokerage',
  type: 'investment',
  subtype: 'brokerage',
})

describe('groupAccounts', () => {
  it('sorts accounts into their kinds, in the screen order, leaving out empty kinds', () => {
    const groups = groupAccounts([loan, savings, checking, card])
    expect(groups.map((group) => group.title)).toEqual([
      'Checking',
      'Credit cards',
      'Savings',
      'Loans',
    ])
    expect(groups[0]!.accounts).toEqual([checking])
    expect(groups[0]!.icon).toBe('wallet')
  })

  it('gives every kind an icon, and a plain one for a kind it does not know', () => {
    expect(kindIcon('credit_card')).toBe('card')
    expect(kindIcon('retirement')).toBe('sunrise')
    expect(kindIcon('unknown' as never)).toBe('accounts')
  })
})

describe('utilization', () => {
  it("is the share of a card's limit used, as a whole percent", () => {
    expect(utilization({ balanceCents: 37000, creditLimitCents: 100000 })).toBe(37)
    // A credit balance (the bank owes you) uses none of the limit.
    expect(utilization({ balanceCents: -500, creditLimitCents: 100000 })).toBe(0)
  })

  it('is unknown without a limit or a balance', () => {
    expect(utilization({ balanceCents: 100, creditLimitCents: null })).toBeNull()
    expect(utilization({ balanceCents: 100, creditLimitCents: 0 })).toBeNull()
    expect(utilization({ balanceCents: null, creditLimitCents: 1000 })).toBeNull()
  })

  it('reads fine to 30%, worth watching above it, and over past the limit', () => {
    expect(utilizationStatus(30)).toBe('ok')
    expect(utilizationStatus(31)).toBe('watch')
    expect(utilizationStatus(100)).toBe('watch')
    expect(utilizationStatus(101)).toBe('over')
  })
})

describe('balanceChange', () => {
  it('is the last balance less the first, and unknown under two days', () => {
    expect(balanceChange([1000, 900, 1500])).toBe(500)
    expect(balanceChange([1000])).toBeNull()
  })
})

describe('accountFacts', () => {
  it('says an overdrawn checking account is overdrawn, in words', () => {
    const short = { ...checking, balanceCents: -14210 }
    expect(accountFacts(short)).toEqual([
      { kind: 'text', label: 'Status', text: 'Overdrawn', tone: 'problem' },
    ])
  })

  it('gives checking what is available once pending charges differ from the balance', () => {
    const pending = { ...checking, balanceCents: 250000, availableCents: 240000 }
    expect(accountFacts(pending)).toEqual([{ kind: 'money', label: 'available', cents: 240000 }])
  })

  it('otherwise gives checking its 30-day change, green with a + when it rose', () => {
    expect(accountFacts(checking, { balances: [1000, 3000] })).toEqual([
      { kind: 'money', label: 'in 30 days', cents: 2000, sign: 'change', tone: 'in' },
    ])
    expect(accountFacts(checking, { balances: [3000, 1000] })[0]).toMatchObject({
      cents: -2000,
      tone: undefined,
    })
    expect(accountFacts(checking)).toEqual([])
  })

  it('gives a card its share of the limit as a ring, and the minimum due', () => {
    expect(accountFacts(card)).toEqual([
      { kind: 'ring', label: 'of limit used', percent: 37, status: 'watch' },
      { kind: 'money', label: 'minimum due', cents: 4100 },
    ])
    const bare = { ...card, creditLimitCents: null, minimumPaymentCents: null }
    expect(accountFacts(bare)).toEqual([])
  })

  it("gives savings its goal's progress, or its change without a goal", () => {
    const fund = goal({
      name: 'Emergency fund',
      targetCents: 100000,
      accountId: 'sav',
      accountBalanceCents: 66000,
    })
    expect(accountFacts(savings, { goals: [fund] })).toEqual([
      { kind: 'ring', label: 'Emergency fund', percent: fund.percent, status: 'ok' },
    ])
    const empty = {
      ...goal({ name: 'Someday', targetCents: 100, accountId: 'sav' }),
      targetCents: 0,
    }
    expect(accountFacts(savings, { goals: [empty], balances: [100, 300] })[0]).toMatchObject({
      kind: 'money',
      cents: 200,
    })
  })

  it('gives investments their change and a line, once there are two days', () => {
    const facts = accountFacts(brokerage, { balances: [100, 200, 150] })
    expect(facts.map((fact) => fact.kind)).toEqual(['money', 'spark'])
    expect(facts[1]).toEqual({
      kind: 'spark',
      label: 'Balance over 30 days',
      values: [100, 200, 150],
    })
    expect(accountFacts(brokerage, { balances: [100] })).toEqual([])
  })

  it('gives a loan its rate and monthly payment, leaving out what it lacks', () => {
    expect(accountFacts(loan)).toEqual([
      { kind: 'text', label: 'rate', text: '4.9% APR' },
      { kind: 'money', label: 'a month', cents: 38500 },
    ])
    expect(accountFacts({ ...loan, aprPercent: null, minimumPaymentCents: null })).toEqual([])
  })

  it('gives any other account its change', () => {
    const house = account({ id: 'h', name: 'House', type: 'property' })
    expect(accountFacts(house, { balances: [10, 20] })[0]).toMatchObject({ cents: 10 })
  })
})

describe('goalsOn and combine', () => {
  it("finds the goals that track an account's balance", () => {
    const mine = goal({ name: 'Mine', targetCents: 1000, accountId: 'sav' })
    const other = goal({ name: 'Other', targetCents: 1000, accountId: 'chk' })
    expect(goalsOn(savings, [mine, other])).toEqual([mine])
  })

  it('adds up what is owned, less what is owed on cards and loans', () => {
    expect(
      combine([
        { type: 'depository', balanceCents: 250000 },
        { type: 'credit', balanceCents: 30000 },
        { type: 'loan', balanceCents: 100000 },
        { type: 'depository', balanceCents: null },
      ]),
    ).toEqual({ ownedCents: 250000, owedCents: 130000, netCents: 120000 })
  })
})
