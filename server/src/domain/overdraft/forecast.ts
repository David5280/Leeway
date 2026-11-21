// Will each checking account make it to payday? Each one's balance is walked
// forward a day at a time: its usual day-to-day spending comes out every day
// before payday, and each bill comes out of the account it is paid from on
// its due date (a bill due on payday itself counts, as it does for safe to
// spend). If the balance would go below zero, the forecast says when and by
// how much, and which other account could spare the money to cover it.
// Pure. Suggestions only: nothing here, or anywhere, moves money.

import { addDays, type IsoDate } from '../../lib/dates.js'

/** A bill coming out of an account before payday. */
export interface ForecastBill {
  name: string
  dueDate: IsoDate
  amountCents: number
}

/** A checking account to walk forward, with what comes out of it. */
export interface ForecastInput {
  accountId: string
  accountName: string
  /** What it holds now: the lower of its balances, negative when overdrawn. */
  startCents: number
  /** Its usual day-to-day spending a day, bills aside. */
  dailySpendCents: number
  /** Bills paid from it before payday (an overdue one dated today). */
  bills: ForecastBill[]
}

/** An account that could cover a shortfall, and how much it can spare. */
export interface SpareAccount {
  accountId: string
  accountName: string
  spareCents: number
}

export interface MoveSuggestion {
  fromAccountId: string
  fromAccountName: string
  amountCents: number
  /** Move it by this day, the day before the balance would go below zero. */
  byDate: IsoDate
}

export interface AccountForecast {
  accountId: string
  accountName: string
  startCents: number
  /** What it would hold on payday, before the paycheck lands. */
  paydayCents: number
  /** The lowest it would get before payday, and the first day it gets there. */
  lowestCents: number
  lowestDate: IsoDate
  /** The first day it would be below zero; null when it never is. */
  belowZeroOn: IsoDate | null
  /** How far below zero it would go at its lowest; 0 when it stays above. */
  shortCents: number
  /** Already below zero today: the one time a forecast is drawn as a problem. */
  overdrawnNow: boolean
  dailySpendCents: number
  /** Day-to-day spending until payday: a day's worth for each day before it. */
  spendingCents: number
  /** The bills coming out before payday, soonest first, and what they come to. */
  bills: ForecastBill[]
  billsCents: number
  /** Where the money could come from, or null when no account can spare it. */
  move: MoveSuggestion | null
}

/** A move is rounded up to this, so it reads as a plain amount with a little room. */
export const MOVE_ROUND_CENTS = 1_000

/** The days from today up to payday, both included. */
function daysThrough(today: IsoDate, payday: IsoDate): IsoDate[] {
  const days: IsoDate[] = []
  for (let day = today; day <= payday; day = addDays(day, 1)) days.push(day)
  return days
}

/** One account walked forward to payday, before any move is suggested. */
export function walkForward(
  input: ForecastInput,
  today: IsoDate,
  payday: IsoDate,
): Omit<AccountForecast, 'move'> {
  let balance = input.startCents
  let lowest = { cents: balance, date: today }
  let belowZeroOn: IsoDate | null = balance < 0 ? today : null
  let spendingCents = 0
  for (const day of daysThrough(today, payday)) {
    // An overdue bill is dated before today; it comes out today.
    const due = input.bills.filter((bill) =>
      day === today ? bill.dueDate <= day : bill.dueDate === day,
    )
    balance -= due.reduce((sum, bill) => sum + bill.amountCents, 0)
    // No day-to-day spending is counted on payday: the paycheck lands that day.
    if (day < payday) {
      spendingCents += input.dailySpendCents
      balance -= input.dailySpendCents
    }
    if (balance < lowest.cents) lowest = { cents: balance, date: day }
    if (balance < 0 && belowZeroOn === null) belowZeroOn = day
  }
  return {
    accountId: input.accountId,
    accountName: input.accountName,
    startCents: input.startCents,
    paydayCents: balance,
    lowestCents: lowest.cents,
    lowestDate: lowest.date,
    belowZeroOn,
    shortCents: Math.max(0, -lowest.cents),
    overdrawnNow: input.startCents < 0,
    dailySpendCents: input.dailySpendCents,
    spendingCents,
    bills: [...input.bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    billsCents: input.bills.reduce((sum, bill) => sum + bill.amountCents, 0),
  }
}

/** A shortfall rounded up to the next MOVE_ROUND_CENTS. */
export const moveAmount = (shortCents: number) =>
  Math.ceil(shortCents / MOVE_ROUND_CENTS) * MOVE_ROUND_CENTS

/**
 * Forecasts for every checking account, each short one with a move from
 * the account that can spare the most: another checking account that stays
 * above zero to payday even after the move, or a savings account. Short
 * accounts are covered soonest first, and what one move takes is not
 * offered again.
 */
export function forecastAccounts(
  inputs: ForecastInput[],
  savings: SpareAccount[],
  today: IsoDate,
  payday: IsoDate,
): AccountForecast[] {
  const walked = inputs.map((input) => walkForward(input, today, payday))
  // A checking account can spare what it holds above zero at its lowest.
  const spare = new Map<string, SpareAccount>()
  for (const forecast of walked) {
    if (forecast.lowestCents > 0) {
      const { accountId, accountName } = forecast
      spare.set(accountId, { accountId, accountName, spareCents: forecast.lowestCents })
    }
  }
  for (const account of savings) {
    if (account.spareCents > 0) spare.set(account.accountId, { ...account })
  }
  const short = walked
    .filter((forecast) => forecast.belowZeroOn !== null)
    .sort((a, b) => a.belowZeroOn!.localeCompare(b.belowZeroOn!))
  const moves = new Map<string, MoveSuggestion>()
  for (const forecast of short) {
    const amountCents = moveAmount(forecast.shortCents)
    const from = [...spare.values()]
      .filter((account) => account.accountId !== forecast.accountId)
      .filter((account) => account.spareCents >= amountCents)
      .sort((a, b) => b.spareCents - a.spareCents)[0]
    if (!from) continue
    from.spareCents -= amountCents
    moves.set(forecast.accountId, {
      fromAccountId: from.accountId,
      fromAccountName: from.accountName,
      amountCents,
      // Already short today: move it today.
      byDate: forecast.belowZeroOn! > today ? addDays(forecast.belowZeroOn!, -1) : today,
    })
  }
  return walked.map((forecast) => ({ ...forecast, move: moves.get(forecast.accountId) ?? null }))
}
