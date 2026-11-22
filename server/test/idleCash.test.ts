// Idle cash math (idleCash.ts): money in checking well past what it needs
// before payday, said with the assumed savings rate, and never while an
// account is overdrawn, safe to spend is tight, payday is a guess or there
// is no spending to go by. idleCashSource.test.ts covers reading the inputs.

import { describe, expect, it } from 'vitest'
import {
  ASSUMED_SAVINGS_APY_PERCENT,
  checkIdleCash,
  CUSHION_FLOOR_CENTS,
  IDLE_FLOOR_CENTS,
  ROUND_TO_CENTS,
  yearlyInterest,
  type IdleCash,
  type IdleCashInputs,
} from '../src/domain/idleCash.js'

/** $8,000 in checking, $1,200 of bills, $50 a day for 10 days, no cards owed: plenty spare. */
const flush = (fields: Partial<IdleCashInputs> = {}): IdleCashInputs => ({
  checkingCents: 800_000,
  billsCents: 120_000,
  cardsOwedCents: 0,
  dailySpendCents: 5_000,
  daysUntilPayday: 10,
  nextPayday: '2026-11-27',
  paydayKnown: true,
  overdrawn: false,
  tight: false,
  ...fields,
})

/** The math the drill shows: checking less every amount kept back, rounding included. */
const shownMath = (idle: IdleCash) =>
  idle.checkingCents -
  idle.billsCents -
  idle.spendingCents -
  idle.cardsOwedCents -
  idle.cushionCents -
  idle.roundedOffCents

describe('checkIdleCash', () => {
  it('suggests what is left past bills, spending and a cushion, rounded down', () => {
    const idle = checkIdleCash(flush())
    // Needed: $1,200 bills + $500 spending + $700 cushion (14 days at $50).
    expect(idle).toMatchObject({
      suggested: true,
      reason: null,
      billsCents: 120_000,
      spendingCents: 50_000,
      cardsOwedCents: 0,
      cushionCents: 70_000,
      neededCents: 240_000,
      roundedOffCents: 0,
      idleCents: 560_000,
      apyPercent: ASSUMED_SAVINGS_APY_PERCENT,
      nextPayday: '2026-11-27',
    })
    // $5,600 at 4% is $224 a year.
    expect(idle.yearlyInterestCents).toBe(22_400)
  })

  it('keeps what the counted cards owe in checking, since checking pays them', () => {
    // $5,000 in checking and $4,000 owed on a card: nothing is spare.
    const owed = checkIdleCash(flush({ checkingCents: 500_000, cardsOwedCents: 400_000 }))
    expect(owed).toMatchObject({
      suggested: false,
      reason: 'not_enough_extra',
      neededCents: 640_000,
      idleCents: 0,
    })
    expect(checkIdleCash(flush({ cardsOwedCents: 100_000 })).idleCents).toBe(460_000)
  })

  it('keeps at least the cushion floor when spending is light', () => {
    const idle = checkIdleCash(flush({ dailySpendCents: 1_000 }))
    expect(idle.cushionCents).toBe(CUSHION_FLOOR_CENTS)
  })

  it('counts a day of spending when payday is today or tomorrow', () => {
    expect(checkIdleCash(flush({ daysUntilPayday: 0 })).spendingCents).toBe(5_000)
  })

  it('rounds the spare cash down to a round hundred, and says what rounding kept back', () => {
    const idle = checkIdleCash(flush({ checkingCents: 805_900 }))
    expect(idle).toMatchObject({ idleCents: 560_000, roundedOffCents: 5_900 })
    expect(ROUND_TO_CENTS).toBe(10_000)
  })

  it('works in whole dollars, as the app shows them, so the math shown is exact', () => {
    const idle = checkIdleCash(
      flush({ checkingCents: 805_999, billsCents: 120_049, cardsOwedCents: 10_050 }),
    )
    expect(idle).toMatchObject({
      checkingCents: 806_000,
      billsCents: 120_000,
      cardsOwedCents: 10_100,
      roundedOffCents: 5_900,
      idleCents: 550_000,
    })
    // $33.33 a day for 10 days is $333.30, shown as $333.
    expect(checkIdleCash(flush({ dailySpendCents: 3_333 })).spendingCents).toBe(33_300)
  })

  it('shows math that adds up to the figure, to the cent', () => {
    for (const fields of [
      {},
      { checkingCents: 805_999 },
      { cardsOwedCents: 123_456, billsCents: 98_765 },
      { dailySpendCents: 3_333 },
    ]) {
      const idle = checkIdleCash(flush(fields))
      expect(idle.suggested).toBe(true)
      expect(shownMath(idle)).toBe(idle.idleCents)
    }
  })

  it(`says nothing for less than the ${IDLE_FLOOR_CENTS / 100} worth moving`, () => {
    const idle = checkIdleCash(flush({ checkingCents: 240_000 + IDLE_FLOOR_CENTS - 100 }))
    expect(idle).toMatchObject({
      suggested: false,
      reason: 'not_enough_extra',
      idleCents: 0,
      roundedOffCents: 0,
    })
    expect(idle.yearlyInterestCents).toBe(0)
    expect(checkIdleCash(flush({ checkingCents: 240_000 + IDLE_FLOOR_CENTS })).suggested).toBe(true)
  })

  it('says nothing, rather than a negative figure, when checking holds less than it needs', () => {
    const idle = checkIdleCash(flush({ checkingCents: 100_000 }))
    expect(idle).toMatchObject({ suggested: false, reason: 'not_enough_extra', idleCents: 0 })
  })

  it('never suggests while an account is overdrawn or safe to spend is tight', () => {
    expect(checkIdleCash(flush({ overdrawn: true }))).toMatchObject({
      suggested: false,
      reason: 'overdrawn',
      idleCents: 0,
    })
    expect(checkIdleCash(flush({ tight: true }))).toMatchObject({
      suggested: false,
      reason: 'tight',
    })
  })

  it('never suggests while payday is only the end of the budget period standing in', () => {
    expect(checkIdleCash(flush({ paydayKnown: false }))).toMatchObject({
      suggested: false,
      reason: 'no_payday',
      idleCents: 0,
    })
  })

  it('never guesses without spending to go by', () => {
    expect(checkIdleCash(flush({ dailySpendCents: null })).reason).toBe('no_spending_history')
    // Whole months that show no spending at all (card payments filed as
    // transfers, say) are a gap in the history, not a month spent on nothing.
    expect(checkIdleCash(flush({ dailySpendCents: 0 }))).toMatchObject({
      suggested: false,
      reason: 'no_spending_history',
      idleCents: 0,
    })
    expect(checkIdleCash(flush({ dailySpendCents: -100 })).reason).toBe('no_spending_history')
    // A cent a day is still spending, and the cushion floor covers it.
    expect(checkIdleCash(flush({ dailySpendCents: 1 })).suggested).toBe(true)
  })

  it('names the most serious reason first', () => {
    const everything = { overdrawn: true, tight: true, paydayKnown: false, dailySpendCents: null }
    expect(checkIdleCash(flush(everything)).reason).toBe('overdrawn')
    expect(checkIdleCash(flush({ ...everything, overdrawn: false })).reason).toBe('tight')
    expect(checkIdleCash(flush({ paydayKnown: false, dailySpendCents: null })).reason).toBe(
      'no_payday',
    )
  })
})

describe('yearlyInterest', () => {
  it('works at the assumed rate unless told another', () => {
    expect(yearlyInterest(100_000)).toBe(4_000)
    expect(yearlyInterest(100_000, 5)).toBe(5_000)
  })
})
