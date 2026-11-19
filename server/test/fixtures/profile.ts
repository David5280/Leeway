// Financial profiles built by hand, for tests of the pure code that words
// them: the insights, the per-kind views and the assistant's digest.

import type { FinancialProfile } from '../../src/domain/profile/profile.js'
import type { SavingsKindReport, SavingsReport } from '../../src/domain/savings/report.js'

const NO_CHANGES = { month: null, days30: null, year: null, all: null }

/** One savings kind holding one counted account with this balance. */
export function kindReport(
  kind: SavingsKindReport['kind'],
  totalCents: number,
  fields: Partial<SavingsKindReport> = {},
): SavingsKindReport {
  const label = { savings: 'Savings', retirement: 'Retirement', investment: 'Investing' }[kind]
  return {
    kind,
    label,
    totalCents,
    changes: NO_CHANGES,
    history: [],
    accounts: [
      {
        id: `acct-${kind}`,
        name: `${label} account`,
        institutionName: 'Test Bank',
        mask: '0001',
        subtype: null,
        manual: false,
        kind,
        kindChosen: false,
        balanceCents: totalCents,
        currency: 'USD',
        notCounted: null,
        changes: NO_CHANGES,
      },
    ],
    ...fields,
  }
}

/** A savings report with these kinds, adding up their totals. */
export function savingsReport(
  kinds: SavingsKindReport[],
  fields: Partial<SavingsReport> = {},
): SavingsReport {
  return {
    hasSavings: kinds.length > 0,
    currency: 'USD',
    totalCents: kinds.reduce((sum, k) => sum + k.totalCents, 0),
    changes: NO_CHANGES,
    historyStartsOn: kinds.length ? '2026-11-19' : null,
    history: [],
    kinds,
    contributions: null,
    ...fields,
  }
}

/** Someone Leeway knows nothing about yet: no accounts, no history, no pay. */
export function emptyProfile(fields: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    asOf: '2026-11-19',
    currency: 'USD',
    locale: 'en-US',
    pay: { cadence: null, source: null, typicalPayCents: null, nextPayday: null },
    monthly: { months: 0, incomeCents: null, spendingCents: null, essentialSpendingCents: null },
    bills: { count: 0, monthlyCents: 0 },
    accounts: [],
    savings: savingsReport([]),
    emergencyFund: null,
    savingsRate: null,
    savingsRateTargetPercent: 20,
    goals: [],
    userContext: [],
    ...fields,
  }
}

/** Whole dollars, as the profile's words use them. */
export const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString('en-US')}`.replace('$-', '-$')
