// Builders for the payday playbook's tests. Every name and amount is made up.

import { billInputSchema, scheduleOf, type Bill } from '../../src/domain/bills.js'
import type { Category } from '../../src/domain/categories.js'
import type { Payday } from '../../src/domain/pay/payday.js'
import type { PaycheckPeriod } from '../../src/domain/pay/period.js'

/** A flexible budget: groceries at $400 a month, unless told otherwise. */
export function category(fields: Partial<Category> = {}): Category {
  return {
    id: 'cat-groceries',
    name: 'Groceries',
    color: '#2a9d8f',
    icon: null,
    kind: 'expense',
    budgetCents: 40_000,
    budgetCadence: 'month',
    warnAtPercent: null,
    trackPace: true,
    providerCategories: [],
    group: null,
    rollover: false,
    rolloverSince: null,
    position: 0,
    ...fields,
  }
}

/** Paid every other Friday, Nov 13, 2026 among them, unless told otherwise. */
export function biweekly(fields: Partial<PaycheckPeriod> = {}): PaycheckPeriod {
  return {
    kind: 'paycheck',
    frequency: 'biweekly',
    anchorDate: '2026-11-13',
    semimonthlyDays: [1, 15],
    ...fields,
  }
}

/** A payday read from paychecks: every two weeks, next on Fri, Nov 27, 2026. */
export function payday(fields: Partial<Payday> = {}): Payday {
  return {
    date: '2026-11-27',
    source: 'detected_income',
    amountCents: 210_000,
    cadence: 'biweek',
    estimate: false,
    ...fields,
  }
}

/**
 * A bill as listBills gives it on `today` (Nov 17, 2026 by default), from
 * the server's own schedule: rent of $1,500 due the 25th of each month,
 * unless told otherwise.
 */
export function billOf(
  fields: Partial<Parameters<typeof scheduleOf>[0]> = {},
  today = '2026-11-17',
): Bill {
  return scheduleOf(
    {
      ...billInputSchema.parse({
        name: 'Rent',
        amountCents: 150_000,
        cadence: 'month',
        anchorDate: '2026-10-25',
      }),
      id: 'bill-rent',
      reads: 'bank_text',
      accountId: null,
      lastPaidDate: null,
      lastPaidCents: null,
      ...fields,
    },
    today,
  )
}
