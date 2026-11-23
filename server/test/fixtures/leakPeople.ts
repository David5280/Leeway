// The reviewers' probes for the leak privacy tests (leakPeople, leakNaming
// and leakPeopleEverywhere): money sent to a person written every way a bank
// writes it, names a bank dresses up, and the merchants that must still be
// named. No probe's name may reach any output.

import type pg from 'pg'
import type { AccountAlert } from '../../src/domain/accountAlerts.js'
import { insertBankTransaction } from '../helpers.js'

/** The people in the probes: names no output may hold. */
export const PERSON = /jane|doe|maria|santos|garcia/i

/** The first of each month from July, the last one at a new amount. */
export const MONTHS = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']

/** One line out: what the bank wrote, its codes, and the old and new amounts. */
export interface Repeating {
  name: string
  merchantName?: string
  primary?: string
  detailed?: string
  /** The same text every month, or one per month (a check's number changes). */
  names?: string[]
  fromCents: number
  toCents: number
}

/** $1,500 a month, then $1,650: the reviewer's amounts for a payment to a person. */
export const RENT = { fromCents: 150_000, toCents: 165_000 }

/** $100 a month, then $120: a smaller payment to a person. */
const SMALL = { fromCents: 10_000, toCents: 12_000 }

/** The reviewer's first probe: $1,500 a month to a person by Zelle, then $1,650. */
export const ZELLE_TO_JANE: Repeating = {
  name: 'Zelle payment to JANE DOE JPM99A1B2C3',
  detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
  ...RENT,
}

/** Spotify at $10.99, then $11.99: a merchant's price rise. */
export const SPOTIFY: Repeating = {
  name: 'SPOTIFY USA',
  merchantName: 'Spotify',
  fromCents: 1_099,
  toCents: 1_199,
}

/**
 * Money sent to a person by bill pay, wire, check or a payment app, with
 * none of the bank's codes, once coded as rent, and with the bank's
 * confirmation number or reference among the words.
 */
export const SENT_TO_JANE: Repeating[] = [
  { name: 'ONLINE PAYMENT TO JANE DOE', ...RENT },
  {
    name: 'ONLINE PAYMENT TO JANE DOE',
    primary: 'RENT_AND_UTILITIES',
    detailed: 'RENT_AND_UTILITIES_RENT',
    ...RENT,
  },
  { name: 'Online Payment 13577083912 To Jane Doe 11/04', ...RENT },
  { name: 'ONLINE TRANSFER REF #IBE7KT4QRS TO JANE DOE', ...RENT },
  { name: 'BILL PAY JANE DOE', ...RENT },
  { name: 'BILL PAYMENT - JANE DOE', primary: 'GENERAL_SERVICES', ...SMALL },
  { name: 'ACH DEBIT JANE DOE', ...RENT },
  { name: 'WIRE TO JANE DOE', ...RENT },
  { name: 'CHECK JANE DOE', ...RENT },
  { name: 'GOOGLE PAY SEND JANE DOE', ...RENT },
  { name: 'ZEL*JANE DOE', ...RENT },
  { name: 'SQC*JANE DOE', ...RENT },
]

/** Every kind of repeating line out a merchant did not charge. */
export const NOT_MERCHANTS: Repeating[] = [
  ZELLE_TO_JANE,
  ...SENT_TO_JANE,
  {
    name: 'VENMO PAYMENT TO SAM RIVER',
    detailed: 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS',
    fromCents: 5_000,
    toCents: 6_000,
  },
  { name: 'CASH APP*ALEX STONE', primary: 'TRANSFER_OUT', fromCents: 4_000, toCents: 5_000 },
  { name: 'PAYPAL TRANSFER TO CHRIS LAKE', fromCents: 2_500, toCents: 3_000 },
  { name: 'ATM WITHDRAWAL MAIN ST', fromCents: 20_000, toCents: 30_000 },
  {
    name: 'CHECK 1041',
    names: ['CHECK 1041', 'CHECK 1042', 'CHECK 1043', 'CHECK 1044', 'CHECK 1045'],
    fromCents: 120_000,
    toCents: 130_000,
  },
  {
    name: 'ONLINE TRANSFER TO SAV',
    detailed: 'TRANSFER_OUT_SAVINGS',
    fromCents: 10_000,
    toCents: 20_000,
  },
]

/**
 * Names a bank dresses up that a merchant may have charged, as far as the
 * words and codes go: each is told with no name, or not at all. Each bank
 * text is its own, so no two share a series.
 */
export const DRESSED_UP_NAMES: Repeating[] = [
  { name: 'WEB AUTHORIZED PMT JANE DOE', primary: 'GENERAL_SERVICES', ...SMALL },
  { name: 'JOHN AND JANE DOE', merchantName: 'John and Jane Doe', ...SMALL },
  { name: 'ONLINE PMT JANE DOE', ...SMALL },
  { name: 'P2P JANE DOE', ...SMALL },
  { name: 'Doe, Jane', ...SMALL },
  { name: 'JANE DOE SR', merchantName: 'Doe,Jane', ...SMALL },
  { name: 'John & Jane Doe', ...SMALL },
  { name: 'Maria De Los Santos Garcia', ...SMALL },
  { name: 'Maria Del Carmen De Los Santos Garcia', ...SMALL },
  { name: 'PAYMENT FOR JANE DOE', ...SMALL },
  { name: 'THE DOE FAMILY', ...SMALL },
  { name: 'JANE OF DOE', ...SMALL },
  { name: 'Jane​Doe', ...SMALL },
  { name: 'Jane Doe2', ...SMALL },
  { name: 'JANE DOE', ...RENT },
  { name: 'PAYPAL *JANEDOE', primary: 'GENERAL_MERCHANDISE', ...SMALL },
  { name: 'JANE M DOE', merchantName: 'Jane Doe', primary: 'GENERAL_SERVICES', ...SMALL },
  {
    name: 'JANE DOE RENT',
    primary: 'RENT_AND_UTILITIES',
    detailed: 'RENT_AND_UTILITIES_RENT',
    ...RENT,
  },
]

/**
 * A person paid through a payment app, whom the bank names as the merchant
 * and codes as a kind of business people rarely are: the bank's code must
 * not vouch for the name. Each is told with no name.
 */
export const APP_PEOPLE: Repeating[] = [
  {
    name: 'VENMO PAYMENT 1234',
    merchantName: 'Jane Doe',
    primary: 'FOOD_AND_DRINK',
    fromCents: 0,
    toCents: 0,
  },
  {
    name: 'PAYPAL *JANE DOE',
    merchantName: 'Jane Doe',
    primary: 'GENERAL_MERCHANDISE',
    fromCents: 0,
    toCents: 0,
  },
  {
    name: 'PAYPAL *JANE DOE',
    merchantName: 'Jane Doe',
    primary: 'ENTERTAINMENT',
    fromCents: 0,
    toCents: 0,
  },
  {
    name: 'CASH APP*JANE DOE',
    merchantName: 'Jane Doe',
    primary: 'GENERAL_MERCHANDISE',
    fromCents: 0,
    toCents: 0,
  },
  {
    name: 'VENMO',
    merchantName: 'JANE DOE',
    primary: 'GENERAL_MERCHANDISE',
    fromCents: 0,
    toCents: 0,
  },
]

/** A person's name charged twice in a day, coded as personal care. */
export const DOE_TWICE: Repeating = {
  name: 'DOE/JANE',
  primary: 'PERSONAL_CARE',
  fromCents: 0,
  toCents: 0,
}

/** Inserts one repeating line on the account, monthly from July, at its new amount in November. */
export async function repeat(db: pg.Pool, accountId: string, line: Repeating): Promise<void> {
  for (const [month, date] of MONTHS.entries()) {
    await insertBankTransaction(db, accountId, {
      date,
      name: line.names?.[month] ?? line.name,
      merchantName: line.merchantName ?? null,
      primary: line.primary ?? null,
      detailed: line.detailed ?? null,
      amountCents: date === MONTHS.at(-1) ? line.toCents : line.fromCents,
    })
  }
}

/** Inserts one line twice on Nov 3, $40 each: the reviewer's probe for a charge made twice. */
export async function twiceOnNov3(db: pg.Pool, accountId: string, line: Repeating): Promise<void> {
  for (let time = 0; time < 2; time++) {
    await insertBankTransaction(db, accountId, {
      date: '2026-11-03',
      name: line.name,
      merchantName: line.merchantName ?? null,
      primary: line.primary ?? null,
      detailed: line.detailed ?? null,
      amountCents: 4_000,
    })
  }
}

/** The money leaks among these alerts. */
export const leaksOf = (alerts: AccountAlert[]) =>
  alerts.filter((alert) => alert.kind === 'price_rise' || alert.kind === 'duplicate_charge')

/** Each leak's sentence, and the merchant it names (null for none). */
export const toldAs = (alerts: AccountAlert[]) =>
  leaksOf(alerts).map((alert) => [alert.message, alert.charge?.merchant ?? null])
