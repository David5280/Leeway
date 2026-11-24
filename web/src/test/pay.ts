// The owner's pay as get_pay returns it, built with the server's own pay
// math from made-up paychecks, so a screen test sees what the server would.

import { currentPay } from '../../../server/src/domain/pay/current'
import type { Deposit } from '../../../server/src/domain/pay/deposits'
import {
  employerIdOf,
  readAsConfirmed,
  type PayOverride,
} from '../../../server/src/domain/pay/ownPay'
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

/** Names as the server would: a business by its name, a payroll in a person's name not at all. */
const NAMES: Record<string, string | null> = {
  'ACME CORP PAYROLL': 'Acme Corp',
  'JANE DOE DIR DEP': null,
  'JOHN ROE DIR DEP': null,
}

/** The salt payer ids are keyed with, fixed so ids read alike in every test. */
const PAYER_SALT = '0'.repeat(32)

/** An id for a job that no longer pays: the owner's pay entered for it then. */
const STOPPED_JOB_ID = 'f'.repeat(16)

/**
 * get_pay's answer for these jobs, with the owner's confirmation or own pay,
 * which stands in for the main job as the server saves it, or with
 * `forStoppedJob` for a job that has since stopped paying.
 */
export function payView(
  jobs: Job[] = [{}],
  given: { confirmed?: boolean; override?: PayOverride; forStoppedJob?: boolean } = {},
): PayView {
  const all = jobs.flatMap(deposits)
  const detected = currentPay(all, PAY_TODAY, null)
  const main = detected.employer
  const salted = { payerSalt: PAYER_SALT }
  const confirmed =
    given.confirmed && main
      ? { payerId: employerIdOf(main, salted), cadence: main.cadence as PayOverride['cadence'] }
      : null
  const mainId = main ? employerIdOf(main, salted) : null
  const override = given.override && {
    ...given.override,
    payerId: given.forStoppedJob ? STOPPED_JOB_ID : mainId,
  }
  const pay = { confirmed, override: override ?? null, payerSalt: PAYER_SALT }
  const settings = settingsWith({ pay })
  const found = readAsConfirmed(all, detected, pay, PAY_TODAY)
  return payViewOf(found, settings, PAY_TODAY, ({ newest }) =>
    newest.name in NAMES ? (NAMES[newest.name] ?? null) : 'Side Gig',
  )
}

/** No paycheck found and none entered. */
export const noPay: PayView = payView([])
