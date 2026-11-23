// Stored charges for the leak alert tests (leakAlerts, leakNotify and
// leakBillPaidTwice): an account whose number the bank also writes in its
// text, Netflix charged twice and Spotify's price going up.

import type pg from 'pg'
import type { AccountAlert } from '../../src/domain/accountAlerts.js'
import { formatCents } from '../../src/lib/money.js'
import { shortDate } from '../../src/lib/words.js'
import { insertBankAccount, insertBankTransaction } from '../helpers.js'

/** Money and dates as the alerts word them for the owner, in US English. */
export const leakFormat = {
  money: (cents: number) => formatCents(cents),
  date: (date: string) => shortDate(date, 'en-US'),
}

/** Whether an alert is a money leak: a charge made twice or a price gone up. */
export const isLeak = (alert: Pick<AccountAlert, 'kind'>) =>
  alert.kind === 'duplicate_charge' || alert.kind === 'price_rise'

/** An account whose number ends 4417, which the bank also writes in its text. */
export const everyday = (db: pg.Pool) => insertBankAccount(db, { name: 'Everyday', mask: '4417' })

/** Netflix charged twice on Nov 3 and 4, as the bank wrote it. */
export async function chargedTwice(db: pg.Pool, accountId: string): Promise<void> {
  for (const date of ['2026-11-03', '2026-11-04']) {
    await insertBankTransaction(db, accountId, {
      date,
      name: 'NETFLIX.COM 4417',
      merchantName: 'Netflix',
      amountCents: 1549,
    })
  }
}

/** Spotify at $10.99 for three months, then $11.99 on Nov 12, on a monthly schedule. */
export async function spotifyRose(db: pg.Pool, accountId: string): Promise<void> {
  for (const [date, amountCents] of [
    ['2026-08-12', 1099],
    ['2026-09-12', 1099],
    ['2026-10-12', 1099],
    ['2026-11-12', 1199],
  ] as const) {
    await insertBankTransaction(db, accountId, {
      date,
      name: 'SPOTIFY USA 4417',
      merchantName: 'Spotify',
      amountCents,
    })
  }
}
