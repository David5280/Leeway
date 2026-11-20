import { describe, expect, it } from 'vitest'
import type { Transaction } from '../api/client'
import { account, transaction } from '../test/fake'
import { bill, goal, series } from '../test/planning'
import {
  balanceReference,
  billMatches,
  billsPaidFrom,
  feesCharged,
  recurringFrom,
} from './accountDetail'

const rent = bill({
  name: 'Rent',
  amountCents: 180000,
  anchorDate: '2026-12-01',
  matchPattern: 'Maple Court',
})
const power = bill({
  name: 'Power',
  amountCents: 9000,
  anchorDate: '2026-12-05',
  matchPattern: 'xcel',
})

/** A charge on the account, named as the bank wrote it. */
const charge = (name: string, fields: Partial<Transaction> = {}) =>
  transaction({ id: name, date: '2026-11-01', name, ...fields })

describe('billMatches', () => {
  it("finds the pattern in the bank's text, ignoring case, digits and punctuation", () => {
    expect(billMatches(rent, charge('MAPLE-COURT APTS #1204 WEB PMT'))).toBe(true)
    expect(billMatches(rent, charge('ACH', { merchantName: 'Maple Court' }))).toBe(true)
    expect(billMatches(rent, charge('MAPLE STREET COFFEE'))).toBe(false)
  })

  it('counts only money out that is not excluded', () => {
    expect(billMatches(rent, charge('MAPLE COURT REFUND', { amountCents: -5000 }))).toBe(false)
    expect(billMatches(rent, charge('MAPLE COURT', { excluded: true }))).toBe(false)
  })

  it('reads the shown name for a bill an assistant patterned', () => {
    const shown = { ...rent, reads: 'shown_name' as const, matchPattern: 'Landlord' }
    expect(billMatches(shown, charge('ACH 0412', { displayName: 'Landlord' }))).toBe(true)
    expect(billMatches(shown, charge('LANDLORD', { displayName: 'Maple Court' }))).toBe(false)
  })

  it('matches nothing without a pattern of letters', () => {
    expect(billMatches({ ...rent, matchPattern: null }, charge('MAPLE COURT'))).toBe(false)
    expect(billMatches({ ...rent, matchPattern: '1204' }, charge('MAPLE COURT 1204'))).toBe(false)
  })
})

describe('billsPaidFrom and recurringFrom', () => {
  it('lists the bills any of the charges pays', () => {
    expect(billsPaidFrom([rent, power], [charge('XCEL ENERGY'), charge('COFFEE')])).toEqual([power])
  })

  it('lists the repeating charges going out of this account, by merchant key', () => {
    const netflix = series({ name: 'Netflix', key: 'netflix com' })
    const payroll = series({ name: 'Payroll', key: 'acme payroll', direction: 'in' })
    const gym = series({ name: 'Gym', key: 'gym' })
    const charges = [
      charge('NETFLIX.COM 8473', { amountCents: 1549 }),
      charge('ACME PAYROLL', { amountCents: -250000 }),
    ]
    expect(recurringFrom([netflix, payroll, gym], charges)).toEqual([netflix])
  })
})

describe('feesCharged', () => {
  it('finds overdraft fees as the server does, and any charge named a fee', () => {
    const overdraft = charge('OVERDRAFT ITEM', { amountCents: 3400 })
    const coded = charge('ITEM 2291', {
      amountCents: 3400,
      bankCategory: 'BANK_FEES_INSUFFICIENT_FUNDS',
    })
    const monthly = charge('MONTHLY SERVICE FEE', { amountCents: 1200 })
    const atm = charge('ATM', { merchantName: 'Out of network fees', amountCents: 300 })
    expect(feesCharged([overdraft, coded, monthly, atm])).toEqual([overdraft, coded, monthly, atm])
  })

  it('leaves out refunds, excluded charges, and transfers that only sound alike', () => {
    expect(
      feesCharged([
        charge('OVERDRAFT FEE REFUND', { amountCents: -3400 }),
        charge('MONTHLY FEE', { amountCents: 1200, excluded: true }),
        charge('OVERDRAFT PROTECTION TRANSFER', { amountCents: 5000 }),
        charge('COFFEE FEEDBACK CAFE', { amountCents: 500 }),
      ]),
    ).toEqual([])
  })
})

describe('balanceReference', () => {
  it('keeps a card under 30% of its limit', () => {
    const card = account({ id: 'c', name: 'Card', type: 'credit', creditLimitCents: 500000 })
    expect(balanceReference(card, [])).toEqual({ cents: 150000, label: 'Under 30% of the limit' })
    expect(balanceReference({ ...card, creditLimitCents: null }, [])).toBeNull()
  })

  it("keeps checking above the level it warns at, the owner's or the default", () => {
    const checking = account({ id: 'k', name: 'Checking', subtype: 'checking' })
    expect(balanceReference(checking, [])).toEqual({
      cents: 10000,
      label: 'Above your low-balance warning',
    })
    expect(balanceReference({ ...checking, lowBalanceCents: 50000 }, [])?.cents).toBe(50000)
    // Zero turns the warning off, so there is no level to keep above.
    expect(balanceReference({ ...checking, lowBalanceCents: 0 }, [])).toBeNull()
  })

  it('aims savings at its goal, and has no level for one without', () => {
    const savings = account({ id: 's', name: 'Savings', subtype: 'savings' })
    const fund = goal({ name: 'Emergency fund', targetCents: 600000, accountId: 's' })
    expect(balanceReference(savings, [fund])).toEqual({
      cents: 600000,
      label: 'Goal: Emergency fund',
    })
    expect(balanceReference(savings, [])).toBeNull()
    const loan = account({ id: 'l', name: 'Loan', type: 'loan' })
    expect(balanceReference(loan, [fund])).toBeNull()
  })
})
