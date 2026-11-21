// The overdraft forecast's math: each checking account walked forward to
// payday, the move that would cover a shortfall, and the alert it raises.
// Pure. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import { forecastAlert, forecastAlerts } from '../src/domain/overdraft/alerts.js'
import {
  forecastAccounts,
  moveAmount,
  walkForward,
  type AccountForecast,
  type ForecastInput,
} from '../src/domain/overdraft/forecast.js'

const TODAY = '2026-11-17'
const PAYDAY = '2026-11-27'

function input(fields: Partial<ForecastInput> = {}): ForecastInput {
  return {
    accountId: 'everyday',
    accountName: 'Everyday',
    startCents: 100_000,
    dailySpendCents: 0,
    bills: [],
    ...fields,
  }
}

const format = {
  money: (cents: number) => `$${cents / 100}`,
  date: (iso: string) => iso.slice(5),
}

const rent = [{ name: 'Rent', dueDate: '2026-11-20', amountCents: 120_000 }]
const savings = { accountId: 'savings', accountName: 'Savings', spareCents: 50_000 }

describe('walkForward', () => {
  it('takes usual spending each day before payday, and none on payday', () => {
    const walked = walkForward(input({ dailySpendCents: 2_000 }), TODAY, PAYDAY)
    // Ten days before payday: Nov 17 to 26.
    expect(walked.spendingCents).toBe(20_000)
    expect(walked.paydayCents).toBe(80_000)
    expect(walked).toMatchObject({ lowestCents: 80_000, lowestDate: '2026-11-26' })
    expect(walked.belowZeroOn).toBeNull()
    expect(walked.shortCents).toBe(0)
  })

  it('takes each bill on its due date, one due on payday included, soonest listed first', () => {
    const bills = [{ name: 'Phone', dueDate: PAYDAY, amountCents: 6_000 }, ...rent]
    const walked = walkForward(input({ bills }), TODAY, PAYDAY)
    expect(walked).toMatchObject({
      belowZeroOn: '2026-11-20',
      lowestCents: -26_000,
      lowestDate: PAYDAY,
      shortCents: 26_000,
      billsCents: 126_000,
      overdrawnNow: false,
    })
    expect(walked.bills.map((bill) => bill.name)).toEqual(['Rent', 'Phone'])
  })

  it('takes an overdue bill today', () => {
    const bills = [{ name: 'Water', dueDate: '2026-11-10', amountCents: 150_000 }]
    expect(walkForward(input({ bills }), TODAY, PAYDAY).belowZeroOn).toBe(TODAY)
  })

  it('knows an account already below zero', () => {
    const walked = walkForward(input({ startCents: -5_000 }), TODAY, PAYDAY)
    expect(walked).toMatchObject({ overdrawnNow: true, belowZeroOn: TODAY, shortCents: 5_000 })
  })
})

describe('forecastAccounts', () => {
  it('rounds a move up to the next $10', () => {
    expect(moveAmount(1)).toBe(1_000)
    expect(moveAmount(20_000)).toBe(20_000)
    expect(moveAmount(20_001)).toBe(21_000)
  })

  it('suggests moving the shortfall from savings by the day before it goes below zero', () => {
    const [everyday] = forecastAccounts([input({ bills: rent })], [savings], TODAY, PAYDAY)
    expect(everyday!.move).toEqual({
      fromAccountId: 'savings',
      fromAccountName: 'Savings',
      amountCents: 20_000,
      byDate: '2026-11-19',
    })
  })

  it('takes it from the account with the most to spare, like checking that stays above zero', () => {
    const second = input({ accountId: 'bills', accountName: 'Bills', startCents: 90_000 })
    const forecasts = forecastAccounts([input({ bills: rent }), second], [savings], TODAY, PAYDAY)
    expect(forecasts[0]!.move?.fromAccountName).toBe('Bills')
    expect(forecasts[1]!.move).toBeNull()
  })

  it('covers the soonest first, and offers no account for more than it has left', () => {
    const later = input({
      accountId: 'second',
      accountName: 'Second',
      bills: [{ name: 'Car', dueDate: '2026-11-25', amountCents: 140_000 }],
    })
    const forecasts = forecastAccounts([later, input({ bills: rent })], [savings], TODAY, PAYDAY)
    // Rent (Nov 20) comes first and takes $200 of the $500; the car's $400 no longer fits.
    expect(forecasts[1]!.move?.amountCents).toBe(20_000)
    expect(forecasts[0]!.move).toBeNull()
  })

  it('moves today for an account already short, never from itself or an empty account', () => {
    const empty = { accountId: 'empty', accountName: 'Empty', spareCents: 0 }
    const [short] = forecastAccounts(
      [input({ startCents: -3_000 })],
      [savings, empty],
      TODAY,
      PAYDAY,
    )
    expect(short!.move).toMatchObject({ fromAccountName: 'Savings', byDate: TODAY })
  })

  it('leaves the move out when nothing can spare enough', () => {
    const [everyday] = forecastAccounts([input({ bills: rent })], [], TODAY, PAYDAY)
    expect(everyday!.move).toBeNull()
  })
})

describe('forecastAlert', () => {
  const plenty = [{ ...savings, spareCents: 90_000 }]
  const walked = (fields: Partial<ForecastInput>) =>
    forecastAccounts([input(fields)], plenty, TODAY, PAYDAY)[0]!

  it('warns, in amber, when checking would go below zero before payday, with the move', () => {
    expect(forecastAlert(walked({ bills: rent }), format)).toEqual({
      kind: 'overdraft_forecast',
      severity: 'warning',
      accountId: 'everyday',
      accountName: 'Everyday',
      amountCents: 20_000,
      count: 1,
      date: '2026-11-20',
      message:
        'Everyday may go $200 below zero on 11-20, before payday. Moving $200 from Savings by 11-19 would cover it.',
      summary: 'Everyday may go below zero on 11-20, before payday.',
    })
  })

  it('says no more than the shortfall when nothing can cover it', () => {
    const forecast: AccountForecast = { ...walked({ bills: rent }), move: null }
    expect(forecastAlert(forecast, format)!.message).toBe(
      'Everyday may go $200 below zero on 11-20, before payday.',
    )
  })

  it('stays quiet when checking lasts, or is overdrawn already (that alert is its own)', () => {
    expect(forecastAlert(walked({}), format)).toBeNull()
    expect(forecastAlert(walked({ startCents: -100 }), format)).toBeNull()
  })

  it('lists the soonest first', () => {
    const later = {
      ...walked({ bills: [{ name: 'Car', dueDate: '2026-11-25', amountCents: 120_000 }] }),
      accountId: 'later',
    }
    const alerts = forecastAlerts([later, walked({}), walked({ bills: rent })], format)
    expect(alerts.map((alert) => alert.accountId)).toEqual(['everyday', 'later'])
  })
})
