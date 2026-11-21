import { describe, expect, it } from 'vitest'
import {
  emergencySteps,
  fundAccounts,
  fundBalance,
  fundCandidates,
  nextStepMonths,
  targetFor,
  type FundAccount,
} from '../src/domain/emergencyPlan.js'

function account(id: string, fields: Partial<FundAccount> = {}): FundAccount {
  return {
    id,
    kind: 'savings',
    hidden: false,
    unsharedAt: null,
    balanceCents: 100_000,
    currency: 'USD',
    ...fields,
  }
}

describe('emergency fund steps', () => {
  it('climbs from one month to three to six', () => {
    expect(emergencySteps(6)).toEqual([1, 3, 6])
    expect(nextStepMonths(1, 6)).toBe(3)
    expect(nextStepMonths(3, 6)).toBe(6)
    expect(nextStepMonths(6, 6)).toBeNull()
  })

  it("adds the owner's own target as a last step when it is longer than six months", () => {
    expect(emergencySteps(9)).toEqual([1, 3, 6, 9])
    expect(nextStepMonths(6, 9)).toBe(9)
    // A shorter target than six changes nothing: the usual advice still climbs to six.
    expect(emergencySteps(4)).toEqual([1, 3, 6])
  })

  it('moves to the next step up from a step the owner typed in between', () => {
    expect(nextStepMonths(2, 6)).toBe(3)
  })

  it('sizes a target as months of essential spending', () => {
    expect(targetFor(3, 250_000)).toBe(750_000)
  })
})

describe('the accounts an emergency fund counts', () => {
  const savings = account('savings')
  const checking = account('checking', { kind: 'checking' })
  const hidden = account('hidden', { hidden: true })
  const gone = account('gone', { unsharedAt: '2026-10-01' })
  const euros = account('euros', { currency: 'EUR' })
  const noBalance = account('none', { balanceCents: null })
  const brokerage = account('brokerage', { kind: 'investment' })
  const all = [savings, checking, hidden, gone, euros, noBalance, brokerage]

  it('can hold the fund only in counted checking and savings, in the owner currency', () => {
    expect(fundCandidates(all, 'USD').map((a) => a.id)).toEqual(['savings', 'checking'])
  })

  it('counts every savings account until the owner marks some', () => {
    expect(fundAccounts(all, [], 'USD')).toEqual({ accounts: [savings], picked: false })
  })

  it('counts only the marked accounts that can still hold it', () => {
    expect(fundAccounts(all, ['checking', 'hidden'], 'USD')).toEqual({
      accounts: [checking],
      picked: true,
    })
    // Marked accounts that can no longer hold it fall back to every savings account.
    expect(fundAccounts(all, ['hidden'], 'USD').picked).toBe(false)
  })

  it('adds up what they hold, an overdrawn account counting as nothing', () => {
    expect(fundBalance([savings, account('low', { balanceCents: -5_000 })])).toBe(100_000)
  })
})
