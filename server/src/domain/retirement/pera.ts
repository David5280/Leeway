// What Colorado PERA publishes, for prefilling a pension form and for a rough
// estimate of a benefit. Pure. Everything here is a starting point the owner
// checks against their own paystub or PERA statement, and is labeled so.

/**
 * Member contribution rates by division, as a percent of gross pay.
 *
 * Read on copera.org on 2026-11-19, from two pages:
 * - "Member Contribution Rates" (Benefit Basics), which lists the current rates.
 * - "Rate Changes - 2027" (Employers), dated July 28, 2026, which says member
 *   rates stay the same in 2027.
 * Rates can change each year under PERA's automatic adjustment provision, so
 * check these against copera.org when that page changes.
 */
export const PERA_MEMBER_RATES = [
  { division: 'state', label: 'State Division', percent: 11 },
  { division: 'school', label: 'School Division', percent: 11 },
  { division: 'dps', label: 'Denver Public Schools Division', percent: 11 },
  { division: 'judicial', label: 'Judicial Division', percent: 11 },
  { division: 'local_government', label: 'Local Government Division', percent: 9 },
  { division: 'safety_officers', label: 'Safety officers', percent: 13 },
] as const

export type PeraDivision = (typeof PERA_MEMBER_RATES)[number]['division']

/** How the form labels a prefilled rate, so it is never mistaken for the owner's own figure. */
export const PERA_RATE_LABEL = "Estimate from PERA's published rate, check your stub"

/**
 * PERA's benefit formula, from "How Your PERA Benefit is Calculated" on
 * copera.org (read 2026-11-19): highest average salary x 2.5% x years of
 * service = monthly lifetime benefit.
 */
export const PERA_MULTIPLIER_PERCENT = 2.5

export interface BenefitEstimateInput {
  /** Highest average salary, per month. */
  monthlySalaryCents: number
  /** Years of service at the age the benefit starts. */
  serviceYears: number
  multiplierPercent: number
}

/**
 * A rough monthly benefit: salary x multiplier x years. It leaves out early
 * retirement reductions, survivor options and cost-of-living increases, and
 * never exceeds the salary itself; the statement from the plan is the real
 * figure.
 */
export function estimateMonthlyBenefit(input: BenefitEstimateInput): number {
  const share = (input.multiplierPercent / 100) * input.serviceYears
  return Math.round(input.monthlySalaryCents * Math.min(share, 1))
}
