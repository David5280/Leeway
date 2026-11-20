import { describe, expect, it } from 'vitest'
import type { Rule } from '../src/domain/rules.js'
import {
  filedElsewhere,
  pairTransfers,
  transferHint,
  unfiledLeg,
  PAIR_WINDOW_DAYS,
  type HintTest,
  type PairCandidate,
} from '../src/domain/transferPairs.js'

/** A transaction as pairing reads it; money out unless the amount says otherwise. */
function tx(
  id: string,
  fields: Partial<PairCandidate> & Pick<PairCandidate, 'accountId' | 'amountCents'>,
): PairCandidate {
  return {
    id,
    date: '2026-11-10',
    name: 'ONLINE TRANSFER',
    merchantName: null,
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
    accountType: 'depository',
    ...fields,
  }
}

/** The pairs found, as sorted "out:arrival" ids, so a test reads them at a glance. */
function pairsOf(transactions: PairCandidate[], hintOk?: HintTest): string[] {
  const partners = pairTransfers(transactions, hintOk)
  return [...partners.entries()]
    .filter(([id]) => transactions.find((t) => t.id === id)!.amountCents > 0)
    .map(([id, partner]) => `${id}:${partner.id}`)
    .sort()
}

describe('transferHint', () => {
  it('reads Plaid transfer and card payment codes as transfers', () => {
    const base = tx('a', { accountId: 'x', amountCents: 100, name: 'Something' })
    expect(
      transferHint({ ...base, providerCategoryDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' }),
    ).toBe('transfer')
    expect(
      transferHint({ ...base, providerCategoryDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' }),
    ).toBe('transfer')
    expect(transferHint({ ...base, providerCategoryPrimary: 'TRANSFER_IN' })).toBe('transfer')
  })

  it('reads a card or loan account’s own side of a loan payment as a transfer, and a car payment out of checking as not', () => {
    const payment = tx('a', {
      accountId: 'x',
      amountCents: -100,
      name: 'PAYMENT',
      providerCategoryDetailed: 'LOAN_PAYMENTS_CAR_PAYMENT',
    })
    expect(transferHint({ ...payment, accountType: 'loan' })).toBe('transfer')
    expect(transferHint({ ...payment, accountType: 'credit' })).toBe('transfer')
    expect(transferHint({ ...payment, accountType: 'depository' })).toBe('other')
  })

  it('reads cash withdrawals, payments to people and other codes as something else', () => {
    const base = tx('a', { accountId: 'x', amountCents: 100, name: 'Something' })
    expect(transferHint({ ...base, providerCategoryDetailed: 'TRANSFER_OUT_WITHDRAWAL' })).toBe(
      'other',
    )
    expect(transferHint({ ...base, name: 'Zelle payment to JANE DOE' })).toBe('other')
    expect(transferHint({ ...base, providerCategoryDetailed: 'INCOME_WAGES' })).toBe('other')
  })

  it('reads pay or money paid back in a line with no code as something else', () => {
    for (const name of [
      'ACME CORP DIR DEP',
      'ACME PAYROLL',
      'DIRECT DEPOSIT ACME',
      'Salary November',
      'Etsy payout',
      'Store refund',
      'Expense reimbursement',
      'Payroll transfer',
    ]) {
      expect(transferHint(tx('x', { accountId: 'a', amountCents: -2000, name }))).toBe('other')
    }
    // Whole words only, and a plain deposit or withdrawal still says nothing.
    for (const name of ['Deposit', 'Withdrawal', 'Paycheckers Diner', 'DIRECTORY DEPOT']) {
      expect(transferHint(tx('x', { accountId: 'a', amountCents: -2000, name }))).toBe('none')
    }
  })

  it('reads the words of a line with no code', () => {
    const base = tx('a', { accountId: 'x', amountCents: 100 })
    expect(transferHint({ ...base, name: 'ONLINE TRANSFER TO SAV ...1234' })).toBe('transfer')
    expect(transferHint({ ...base, name: 'Payment - Thank you' })).toBe('transfer')
    expect(transferHint({ ...base, name: 'CHASE CREDIT CRD AUTOPAY' })).toBe('transfer')
    expect(transferHint({ ...base, name: 'x', merchantName: 'Funds transfer' })).toBe('transfer')
    expect(transferHint({ ...base, name: 'KING SOOPERS' })).toBe('none')
  })
})

describe('pairTransfers', () => {
  it('pairs money out of one account with the same amount arriving in another', () => {
    expect(
      pairsOf([
        tx('out', { accountId: 'checking', amountCents: 50000 }),
        tx('in', { accountId: 'savings', amountCents: -50000, date: '2026-11-12' }),
      ]),
    ).toEqual(['out:in'])
  })

  it('never pairs a side that says nothing either way, even with a transfer', () => {
    expect(
      pairsOf([
        tx('out', { accountId: 'checking', amountCents: 2500 }),
        tx('in', { accountId: 'card', amountCents: -2500, name: 'Thanks' }),
      ]),
    ).toEqual([])
  })

  it('does not pair an imported purchase with a friend paying in by transfer', () => {
    // A line from a file has no code; its store number says nothing about a transfer.
    expect(
      pairsOf([
        tx('target', { accountId: 'imported-card', amountCents: 5000, name: 'TARGET 00012345' }),
        tx('friend', {
          accountId: 'checking',
          amountCents: -5000,
          name: 'ONLINE TRANSFER FROM A FRIEND',
          providerCategoryPrimary: 'TRANSFER_IN',
        }),
      ]),
    ).toEqual([])
  })

  it('does not pair an imported refund with rent sent out by transfer', () => {
    expect(
      pairsOf([
        tx('rent', {
          accountId: 'checking',
          amountCents: 2500,
          name: 'ONLINE TRANSFER TO LANDLORD',
          providerCategoryPrimary: 'TRANSFER_OUT',
        }),
        tx('refund', { accountId: 'imported-card', amountCents: -2500, name: 'REFUND' }),
      ]),
    ).toEqual([])
  })

  it('pairs imported or hand-added lines when both say they are a transfer', () => {
    expect(
      pairsOf([
        tx('out', { accountId: 'manual-checking', amountCents: 2500, name: 'Transfer to savings' }),
        tx('in', { accountId: 'imported-savings', amountCents: -2500, name: 'XFER FROM CHK' }),
      ]),
    ).toEqual(['out:in'])
  })

  it('does not pair two sides that say nothing about being a transfer', () => {
    expect(
      pairsOf([
        tx('out', { accountId: 'checking', amountCents: 2500, name: 'KING SOOPERS' }),
        tx('in', { accountId: 'card', amountCents: -2500, name: 'REFUND' }),
      ]),
    ).toEqual([])
  })

  it('pairs unfiled legs that say nothing, but never one that says it is something else', () => {
    const silent = [
      tx('out', { accountId: 'checking', amountCents: 300000, name: 'ONLINE BANKING' }),
      tx('in', { accountId: 'savings', amountCents: -300000, name: 'DEPOSIT', date: '2026-11-12' }),
    ]
    expect(pairsOf(silent, unfiledLeg)).toEqual(['out:in'])
    // The usual test still wants both sides to say so.
    expect(pairsOf(silent)).toEqual([])
    const pay = tx('in', {
      accountId: 'savings',
      amountCents: -300000,
      name: 'ACME PAYROLL',
      providerCategoryDetailed: 'INCOME_WAGES',
    })
    expect(pairsOf([silent[0]!, pay], unfiledLeg)).toEqual([])
    // A silent line on a card is a purchase, never one side of a move.
    const dinner = tx('out', {
      accountId: 'card',
      amountCents: 5000,
      accountType: 'credit',
      name: 'DINNER AT LUCA',
    })
    const deposit = tx('in', { accountId: 'checking', amountCents: -5000, name: 'DEPOSIT' })
    expect(pairsOf([dinner, deposit], unfiledLeg)).toEqual([])
    // A card's side of a payment says so, and pairs with a silent withdrawal.
    const payment = tx('in', {
      accountId: 'card',
      amountCents: -5000,
      accountType: 'credit',
      name: 'PAYMENT THANK YOU',
    })
    const withdrawal = tx('out', { accountId: 'checking', amountCents: 5000, name: 'WITHDRAWAL' })
    expect(pairsOf([withdrawal, payment], unfiledLeg)).toEqual(['out:in'])
  })

  it('does not pair a paycheck or a purchase with a transfer of the same amount', () => {
    expect(
      pairsOf([
        tx('out', { accountId: 'checking', amountCents: 2500 }),
        tx('pay', {
          accountId: 'savings',
          amountCents: -2500,
          name: 'ACME PAYROLL',
          providerCategoryDetailed: 'INCOME_WAGES',
        }),
      ]),
    ).toEqual([])
  })

  it('does not pair a payment to another person', () => {
    expect(
      pairsOf([
        tx('out', { accountId: 'checking', amountCents: 2500, name: 'Zelle payment to Jane' }),
        tx('in', { accountId: 'savings', amountCents: -2500 }),
      ]),
    ).toEqual([])
  })

  it('needs different accounts, the same amount and dates within the window', () => {
    const out = tx('out', { accountId: 'checking', amountCents: 1000 })
    expect(pairsOf([out, tx('same', { accountId: 'checking', amountCents: -1000 })])).toEqual([])
    expect(pairsOf([out, tx('more', { accountId: 'savings', amountCents: -1001 })])).toEqual([])
    const late = `2026-11-${10 + PAIR_WINDOW_DAYS + 1}`
    expect(
      pairsOf([out, tx('late', { accountId: 'savings', amountCents: -1000, date: late })]),
    ).toEqual([])
    const edge = `2026-11-${10 + PAIR_WINDOW_DAYS}`
    expect(
      pairsOf([out, tx('edge', { accountId: 'savings', amountCents: -1000, date: edge })]),
    ).toEqual(['out:edge'])
  })

  it('pairs the closest dates first, and each side only once', () => {
    expect(
      pairsOf([
        tx('out1', { accountId: 'checking', amountCents: 1000, date: '2026-11-10' }),
        tx('out2', { accountId: 'checking', amountCents: 1000, date: '2026-11-14' }),
        tx('in1', { accountId: 'savings', amountCents: -1000, date: '2026-11-13' }),
        tx('in2', { accountId: 'savings', amountCents: -1000, date: '2026-11-11' }),
      ]),
    ).toEqual(['out1:in2', 'out2:in1'])
  })

  it('pairs the same way whatever order the transactions come in', () => {
    const transactions = [
      tx('b-out', { accountId: 'checking', amountCents: 1000 }),
      tx('a-out', { accountId: 'brokerage', amountCents: 1000 }),
      tx('in', { accountId: 'savings', amountCents: -1000 }),
    ]
    const forwards = pairsOf(transactions)
    expect(forwards).toEqual(['a-out:in'])
    expect(pairsOf([...transactions].reverse())).toEqual(forwards)
  })

  it('pairs money out with the arrival of lower id when two are equally close', () => {
    expect(
      pairsOf([
        tx('out', { accountId: 'checking', amountCents: 1000 }),
        tx('in-b', { accountId: 'savings', amountCents: -1000 }),
        tx('in-a', { accountId: 'brokerage', amountCents: -1000 }),
      ]),
    ).toEqual(['out:in-a'])
  })

  it('names each side as the other one’s partner', () => {
    const out = tx('out', { accountId: 'checking', amountCents: 700 })
    const arrival = tx('in', { accountId: 'savings', amountCents: -700 })
    const partners = pairTransfers([out, arrival])
    expect(partners.get('out')).toBe(arrival)
    expect(partners.get('in')).toBe(out)
  })
})

describe('filedElsewhere', () => {
  const kinds = new Map([
    ['groceries', 'expense' as const],
    ['transfers', 'transfer' as const],
  ])
  const rule = (categoryId: string): Rule => ({
    id: `rule-${categoryId}`,
    field: 'description',
    matchType: 'contains',
    pattern: 'transfer',
    minAmountCents: null,
    maxAmountCents: null,
    categoryId,
    position: 0,
    reads: 'bank_text',
  })
  const line = {
    name: 'ONLINE TRANSFER',
    merchantName: null,
    amountCents: 2500,
    shownName: 'Transfer',
  }

  it('says so for a transaction filed by hand under another kind', () => {
    const byHand = { ...line, categorySource: 'manual' }
    expect(filedElsewhere({ ...byHand, categoryKind: 'expense' }, [], kinds)).toBe(true)
    expect(filedElsewhere({ ...byHand, categoryKind: null }, [], kinds)).toBe(true)
    expect(filedElsewhere({ ...byHand, categoryKind: 'transfer' }, [], kinds)).toBe(false)
  })

  it('says so when a rule files it under another kind, unless filed by hand as a transfer', () => {
    const filed = { ...line, categorySource: 'provider', categoryKind: 'transfer' as const }
    expect(filedElsewhere(filed, [rule('groceries')], kinds)).toBe(true)
    expect(filedElsewhere(filed, [rule('transfers')], kinds)).toBe(false)
    expect(filedElsewhere(filed, [], kinds)).toBe(false)
    const byHand = { ...filed, categorySource: 'manual' }
    expect(filedElsewhere(byHand, [rule('groceries')], kinds)).toBe(false)
  })
})
