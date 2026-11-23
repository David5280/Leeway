// City Power, the varying bill the following tests share: tracked long ago
// at $110, then $100, $140, $90 and $130 from July to October, a history that
// varies by itself. The test clock reads 2026-11-17.

import type pg from 'pg'
import type { WatchedBill } from '../../src/domain/billChanges.js'
import type { BillCharge } from '../../src/domain/billCycles.js'
import type { ActionCaller } from '../actionCaller.js'
import { insertBankAccount, insertBankTransaction } from '../helpers.js'

/** The day the tests read the bill on. */
export const TODAY = '2026-11-17'

/** A charge on the checking account, or on `accountId`. */
export const paid = (date: string, amountCents: number, accountId = 'checking'): BillCharge => ({
  accountId,
  date,
  amountCents,
})

/** City Power, flagged as varying, charged `charges` (newest first). */
export const cityPower = (
  charges: BillCharge[],
  fields: Partial<WatchedBill> = {},
): WatchedBill => ({
  id: 'bill-1',
  name: 'City Power',
  amountCents: 11000,
  cadence: 'month',
  trackedOn: '2025-01-01',
  amountVaries: true,
  amountSetOn: null,
  followAfterOn: null,
  charges,
  ...fields,
})

/** $130, $90, $140 and $100 from July to October, newest first. */
export const SWINGS = [
  paid('2026-10-16', 13000),
  paid('2026-09-16', 9000),
  paid('2026-08-17', 14000),
  paid('2026-07-16', 10000),
]

/** The same history as stored charges, oldest first: dates and amounts. */
export const SWUNG = [
  ['2026-07-16', 10000],
  ['2026-08-17', 14000],
  ['2026-09-16', 9000],
  ['2026-10-16', 13000],
] as const

/** A charge's date and amount, as the stored bill's tests add them. */
export type StoredCharge = readonly [date: string, amountCents: number]

/** Adds City Power charges to an account, as the bank writes them. */
export async function addCharges(
  db: pg.Pool,
  accountId: string,
  charges: readonly StoredCharge[],
): Promise<void> {
  for (const [date, amountCents] of charges) {
    await insertBankTransaction(db, accountId, {
      date,
      name: 'CITY POWER 4417',
      merchantName: 'City Power',
      amountCents,
    })
  }
}

/** City Power added by hand at $110 in June, with autopay, then charged each of `charges`. */
export async function cityPowerCharged(
  db: pg.Pool,
  { call }: ActionCaller,
  charges: readonly StoredCharge[],
): Promise<{ billId: string; accountId: string }> {
  const { accountId } = await insertBankAccount(db, { name: 'Everyday' })
  const bill = await call('create_bill', {
    name: 'City Power',
    amountCents: 11000,
    cadence: 'month',
    anchorDate: '2026-11-20',
    matchPattern: 'city power',
    autopay: true,
  })
  await db.query(`UPDATE bills SET created_at = '2026-06-25' WHERE id = $1`, [bill.id])
  await addCharges(db, accountId, charges)
  return { billId: bill.id, accountId }
}

/** A bill's usual amount, as list_bills shows it. */
export async function usualOf({ call }: ActionCaller, billId: string): Promise<number> {
  return (await call('list_bills')).bills.find((bill) => bill.id === billId)!.amountCents
}
