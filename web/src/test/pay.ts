// The owner's pay as get_pay returns it, built with the server's own pay
// math from made-up paychecks, so a screen test sees what the server would.

import { currentPay } from '../../../server/src/domain/pay/current'
import type { Deposit } from '../../../server/src/domain/pay/deposits'
import { payerKeyOf, type PayOverride } from '../../../server/src/domain/pay/given'
import { payViewOf } from '../../../server/src/domain/pay/view'
import { addDays } from '../../../server/src/lib/dates'
import type { PayView } from '../api/client'
import { settingsWith } from './fake'

export const PAY_TODAY = '2026-11-17'

/** A payroll deposit from a made-up employer. */
function paycheck(date: string, cents: number, name: string, index: number): Deposit {
  return {
    id: `pay-${name}-${index}`,
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

export interface Job {
  name?: string
  cents?: number
  /** Days between paychecks. */
  every?: number
  /** How many have landed, the last on `last`. */
  count?: number
  last?: string
}

function deposits({
  name = 'ACME CORP PAYROLL',
  cents = 210_000,
  every = 14,
  count = 6,
  last = '2026-11-13',
}: Job): Deposit[] {
  return Array.from({ length: count }, (_, i) =>
    paycheck(addDays(last, -(count - 1 - i) * every), cents, name, i),
  )
}

/** get_pay's answer for these jobs, with the owner's confirmation or own pay. */
export function payView(
  jobs: Job[] = [{}],
  given: { confirmed?: boolean; override?: PayOverride } = {},
): PayView {
  const detected = currentPay(jobs.flatMap(deposits), PAY_TODAY, null)
  const confirmed =
    given.confirmed && detected.employer
      ? { payerKey: payerKeyOf(detected.employer), cadence: detected.employer.cadence }
      : null
  const settings = settingsWith({ pay: { confirmed, override: given.override ?? null } })
  return payViewOf(detected, settings, PAY_TODAY, (employer) =>
    employer.newest.name === 'ACME CORP PAYROLL' ? 'Acme Corp' : 'Side Gig',
  )
}

/** No paycheck found and none entered. */
export const noPay: PayView = payView([])
