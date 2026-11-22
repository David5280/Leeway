import { describe, expect, it } from 'vitest'
import {
  accountsOtherGoalsFollow,
  emergencySavedCents,
  emergencySteps,
  findFund,
  fundAccounts,
  fundBalance,
  fundCandidates,
  fundChoices,
  fundSaved,
  monthsOf,
  namesEmergencyFund,
  nextStepMonths,
  targetFor,
  type FundAccount,
} from '../src/domain/emergencyPlan.js'

function account(id: string, fields: Partial<FundAccount> = {}): FundAccount & { name: string } {
  return {
    id,
    name: id,
    kind: 'savings',
    hidden: false,
    unsharedAt: null,
    balanceCents: 100_000,
    currency: 'USD',
    ...fields,
  }
}

/** A goal with only the fields the fund's rules read. */
interface TestGoal {
  id: string
  name: string
  accountId: string | null
  emergencyMonths: number | null
  currentCents: number
}

function goal(name: string, fields: Partial<TestGoal> = {}): TestGoal {
  return { id: name, name, accountId: null, emergencyMonths: null, currentCents: 0, ...fields }
}

const NONE = { markedIds: [], otherGoalAccountIds: [] }

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
  })

  it("stops at the owner's own target when it is shorter than six months", () => {
    expect(emergencySteps(4)).toEqual([1, 3, 4])
    expect(nextStepMonths(3, 4)).toBe(4)
    expect(nextStepMonths(4, 4)).toBeNull()
    expect(emergencySteps(3)).toEqual([1, 3])
    expect(emergencySteps(2)).toEqual([1, 2])
    expect(emergencySteps(1)).toEqual([1])
    expect(nextStepMonths(1, 1)).toBeNull()
  })

  it('offers no step once the fund aims past a target the owner lowered', () => {
    expect(nextStepMonths(6, 4)).toBeNull()
  })

  it('moves to the next step up from a step or an own target in between', () => {
    expect(nextStepMonths(2, 6)).toBe(3)
    expect(nextStepMonths(1.2, 6)).toBe(3)
  })

  it('sizes a target as months of essential spending, and tells an amount in months', () => {
    expect(targetFor(3, 250_000)).toBe(750_000)
    expect(monthsOf(300_000, 260_000)).toBe(1.2)
  })
})

describe('which goal is the emergency fund', () => {
  it('reads a goal named as an emergency fund, in any case', () => {
    for (const name of ['Emergency fund', 'EMERGENCY SAVINGS', 'My rainy day pot', 'rainy  day']) {
      expect(namesEmergencyFund(name)).toBe(true)
    }
    for (const name of ['Emergency', 'Trip', 'Fund for a rainy weekend', 'Emergency room bill']) {
      expect(namesEmergencyFund(name)).toBe(false)
    }
  })

  it('takes the goal marked as the fund over one only named as one', () => {
    const named = goal('Rainy day')
    const marked = goal('Cushion', { emergencyMonths: 3 })
    expect(findFund([named, marked])).toBe(marked)
    expect(findFund([goal('Trip'), named])).toBe(named)
    expect(findFund([goal('Trip')])).toBeNull()
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
    expect(fundAccounts(all, NONE, 'USD')).toEqual({ accounts: [savings], counts: 'savings' })
  })

  it('counts only the marked accounts that can still hold it', () => {
    const marked = fundAccounts(all, { ...NONE, markedIds: ['checking', 'hidden'] }, 'USD')
    expect(marked).toEqual({ accounts: [checking], counts: 'marked' })
  })

  it('never swaps marked accounts it cannot count for every savings account', () => {
    // A hidden marked account counts nothing, rather than every savings account behind the owner's back.
    expect(fundAccounts(all, { ...NONE, markedIds: ['hidden'] }, 'USD')).toEqual({
      accounts: [],
      counts: 'marked',
    })
  })

  it('leaves out an account another goal follows, marked or not', () => {
    const trip = { markedIds: [], otherGoalAccountIds: ['savings'] }
    expect(fundAccounts(all, trip, 'USD').accounts).toEqual([])
    const marked = { markedIds: ['savings', 'checking'], otherGoalAccountIds: ['savings'] }
    expect(fundAccounts(all, marked, 'USD').accounts).toEqual([checking])
  })

  it('adds up what they hold, an overdrawn account counting as nothing', () => {
    expect(fundBalance([savings, account('low', { balanceCents: -5_000 })])).toBe(100_000)
    expect(fundBalance([savings, account('new', { balanceCents: null })])).toBe(100_000)
  })
})

describe("the fund's list of accounts", () => {
  it('shows each account it could count, why any is left out, and hides the noise', () => {
    const accounts = [
      account('savings'),
      account('trip'),
      account('hidden', { hidden: true }),
      account('hiddenMarked', { hidden: true }),
      account('gone', { unsharedAt: '2026-10-01' }),
      account('euros', { currency: 'EUR' }),
      account('brokerage', { kind: 'investment' }),
    ]
    const choices = fundChoices(
      accounts,
      {
        markedIds: ['savings', 'hiddenMarked', 'euros'],
        countedIds: ['savings'],
        otherGoals: new Map([['trip', 'Trip']]),
      },
      'USD',
    )
    expect(choices.map((c) => [c.id, c.counted, c.marked, c.leftOut, c.otherGoal])).toEqual([
      ['savings', true, true, null, null],
      ['trip', false, false, 'other_goal', 'Trip'],
      ['hiddenMarked', false, true, 'hidden', null],
      ['euros', false, true, 'unavailable', null],
    ])
    const gone = fundChoices(
      [account('gone', { unsharedAt: '2026-10-01' })],
      { markedIds: ['gone'], countedIds: [], otherGoals: new Map() },
      'USD',
    )
    expect(gone[0]!.leftOut).toBe('not_shared')
  })

  it('names the goals other than the fund that follow an account', () => {
    const goals = [
      goal('Trip', { accountId: 'a' }),
      goal('Car', { accountId: 'a' }),
      goal('Fund', { accountId: 'b' }),
      goal('Jar'),
    ]
    expect(accountsOtherGoalsFollow(goals, 'Fund')).toEqual(new Map([['a', 'Trip']]))
  })
})

describe('what the fund holds', () => {
  const accounts = [account('savings', { balanceCents: 300_000 }), account('spare')]

  it("is the fund goal's progress once there is a fund", () => {
    const goals = [goal('Emergency fund', { emergencyMonths: 1, currentCents: 50_000 })]
    expect(emergencySavedCents(goals, accounts, 'USD')).toBe(50_000)
  })

  it('is every savings account no goal follows before there is a fund', () => {
    expect(emergencySavedCents([], accounts, 'USD')).toBe(400_000)
    const trip = [goal('Trip', { accountId: 'savings' })]
    expect(emergencySavedCents(trip, accounts, 'USD')).toBe(100_000)
  })

  it('is nothing to speak of with neither a fund nor a savings account', () => {
    expect(fundSaved([], [], 'USD', false)).toBeNull()
    expect(fundSaved([], accounts, 'USD', true)).toBe(400_000)
    const named = [goal('Rainy day', { currentCents: 7_000 })]
    expect(fundSaved(named, [], 'USD', false)).toBe(7_000)
  })
})
