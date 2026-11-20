// Retirement fixtures for the web's tests: a pension, and a financial profile
// holding a retirement plan. Built from the server's own types and math, so a
// view in a test is one the server could send, without the web reaching into
// the server's test folder.

import type { FinancialProfile } from '../../../server/src/domain/profile/profile'
import {
  retirementSchema,
  type RetirementPatch,
} from '../../../server/src/domain/retirement/assumptions'
import {
  EMPTY_PLAN,
  type Pension,
  type PensionPlan,
} from '../../../server/src/domain/retirement/pensions'
import { retirementPlan, type RetirementInput } from '../../../server/src/domain/retirement/plan'
import type { SavingsReport } from '../../../server/src/domain/savings/report'

/** The day the profile was worked out, which sets the owner's age. */
const AS_OF = '2026-11-19'

const NO_CHANGES = { month: null, days30: null, year: null, all: null }

/** A pension named Colorado PERA, with every plan figure blank unless given. */
export function pension(plan: Partial<PensionPlan> = {}, fields: Partial<Pension> = {}): Pension {
  return {
    accountId: 'pension-1',
    name: 'Colorado PERA',
    balanceCents: null,
    plan: { ...EMPTY_PLAN, ...plan },
    ...fields,
  }
}

/** Savings with one retirement account of this balance, or none at all. */
function retirementSavings(cents: number): SavingsReport {
  const account = {
    id: 'acct-retirement',
    name: 'Retirement account',
    institutionName: 'Test Bank',
    subtype: null,
    manual: false,
    kind: 'retirement' as const,
    kindChosen: false,
    balanceCents: cents,
    currency: 'USD',
    notCounted: null,
    changes: NO_CHANGES,
  }
  const kinds = cents
    ? [
        {
          kind: 'retirement' as const,
          label: 'Retirement',
          totalCents: cents,
          changes: NO_CHANGES,
          history: [],
          accounts: [account],
        },
      ]
    : []
  return {
    hasSavings: kinds.length > 0,
    currency: 'USD',
    totalCents: cents,
    changes: NO_CHANGES,
    historyStartsOn: kinds.length ? AS_OF : null,
    history: [],
    kinds,
    contributions: null,
  }
}

/**
 * Someone with only a retirement plan: the savings it counts, the pensions
 * given, and nothing else known. pensionPay is what goes into the pension
 * from pay, as the profile works it out from the plans.
 */
export function retirementProfile(
  fields: Partial<RetirementInput> = {},
  assumptions: RetirementPatch = {},
  pensionPay: FinancialProfile['pensionPay'] = { memberCents: null, employerCents: null },
): FinancialProfile {
  return {
    asOf: AS_OF,
    currency: 'USD',
    locale: 'en-US',
    pay: {
      cadence: null,
      source: null,
      typicalPayCents: null,
      nextPayday: null,
      estimate: false,
      employer: null,
      since: null,
    },
    monthly: {
      incomeCents: null,
      incomeEstimated: false,
      spendingCents: null,
      essentialSpendingCents: null,
      spendingSince: null,
      spendingDays: 0,
    },
    bills: { count: 0, monthlyCents: 0 },
    accounts: [],
    savings: retirementSavings(fields.retirementCents ?? 0),
    emergencyFund: null,
    savingsRate: null,
    savingsRateTargetPercent: null,
    pensionPay,
    retirement: retirementPlan({
      today: AS_OF,
      assumptions: retirementSchema.parse(assumptions),
      retirementCents: 0,
      investmentCents: 0,
      cashCents: null,
      emergencyTargetCents: null,
      foundMonthlyContributionCents: null,
      recentMonthlySpendingCents: null,
      pensions: [],
      payCadence: null,
      ...fields,
    }),
    goals: [],
    userContext: [],
  }
}
