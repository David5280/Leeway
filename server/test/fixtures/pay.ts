// Made-up paychecks for the payday tests: deposits as domain/pay reads them,
// and the same paychecks inserted as bank transactions. Every name and
// amount here is invented.

import type pg from 'pg'
import { addDays } from '../../src/lib/dates.js'
import type { Deposit } from '../../src/domain/pay/deposits.js'
import { insertBankTransaction } from '../helpers.js'

let next = 0

/** A payroll deposit (positive cents here, stored as money in). */
export function paycheck(date: string, cents: number, name = 'ACME CORP PAYROLL'): Deposit {
  next += 1
  return {
    id: `p${next}`,
    accountId: 'checking',
    date,
    name,
    merchantName: null,
    amountCents: -cents,
    providerCategoryPrimary: 'INCOME',
    providerCategoryDetailed: 'INCOME_SALARY',
    accountType: 'depository',
    categoryKind: null,
  }
}

/** Paydays every `step` days from `first`, `count` of them. */
export function everyDays(first: string, step: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(first, i * step))
}

/** Inserts payroll deposits into an account on each day. */
export async function insertPaychecks(
  db: pg.Pool,
  accountId: string,
  days: string[],
  cents: number,
  name = 'ACME CORP PAYROLL',
): Promise<void> {
  for (const date of days) {
    await insertBankTransaction(db, accountId, {
      date,
      name,
      amountCents: -cents,
      primary: 'INCOME',
      detailed: 'INCOME_SALARY',
    })
  }
}
