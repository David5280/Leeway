// Pension plans as rows of pension_plans, kept beside each pension's account:
// reading them and writing one whole. Percents are kept in basis points.

import type { Db } from '../../db/pool.js'
import type { PensionContribution, PensionPlan } from './pensions.js'

interface PlanRow {
  accountId: string
  contributionCents: number | null
  contributionBps: number | null
  employerContributionBps: number | null
  grossPayCents: number | null
  payCadence: PensionPlan['payCadence']
  serviceYears: number | null
  salaryBasisCents: number | null
  multiplierBps: number | null
  statementBenefitCents: number | null
  benefitAge: number | null
  checkedOn: string | null
}

/** Percents are stored in basis points, which keep a figure like 10.5% or 2.25% exact. */
const toBps = (value: number | null) => (value === null ? null : Math.round(value * 100))
const fromBps = (value: number | null) => (value === null ? null : value / 100)

function planFromRow(row: PlanRow): PensionPlan {
  let contribution: PensionContribution | null = null
  if (row.contributionCents !== null) {
    contribution = { kind: 'amount', cents: row.contributionCents }
  } else if (row.contributionBps !== null) {
    contribution = { kind: 'percent', percent: row.contributionBps / 100 }
  }
  return {
    contribution,
    employerContributionPercent: fromBps(row.employerContributionBps),
    grossPayCents: row.grossPayCents,
    payCadence: row.payCadence,
    serviceYears: row.serviceYears,
    salaryBasisMonthlyCents: row.salaryBasisCents,
    multiplierPercent: fromBps(row.multiplierBps),
    statementBenefitMonthlyCents: row.statementBenefitCents,
    benefitAge: row.benefitAge,
    checkedOn: row.checkedOn,
  }
}

/** The stored plan of each of these accounts that has one, by account id. */
export async function plansOf(db: Db, accountIds: string[]): Promise<Map<string, PensionPlan>> {
  if (accountIds.length === 0) return new Map()
  const { rows } = await db.query<PlanRow>(
    `SELECT account_id AS "accountId", contribution_cents AS "contributionCents",
       contribution_bps AS "contributionBps", employer_contribution_bps AS "employerContributionBps",
       gross_pay_cents AS "grossPayCents", pay_cadence AS "payCadence",
       service_years::float8 AS "serviceYears", salary_basis_cents AS "salaryBasisCents",
       multiplier_bps AS "multiplierBps", statement_benefit_cents AS "statementBenefitCents",
       benefit_age AS "benefitAge", checked_on AS "checkedOn"
     FROM pension_plans WHERE account_id = ANY($1::uuid[])`,
    [accountIds],
  )
  return new Map(rows.map((row) => [row.accountId, planFromRow(row)]))
}

/** Writes a pension's whole plan, adding the row the first time. */
export async function savePlan(db: Db, accountId: string, plan: PensionPlan): Promise<void> {
  const { contribution } = plan
  await db.query(
    `INSERT INTO pension_plans (account_id, contribution_cents, contribution_bps,
       employer_contribution_bps, gross_pay_cents, pay_cadence, service_years, salary_basis_cents,
       multiplier_bps, statement_benefit_cents, benefit_age, checked_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (account_id) DO UPDATE SET
       contribution_cents = EXCLUDED.contribution_cents,
       contribution_bps = EXCLUDED.contribution_bps,
       employer_contribution_bps = EXCLUDED.employer_contribution_bps,
       gross_pay_cents = EXCLUDED.gross_pay_cents, pay_cadence = EXCLUDED.pay_cadence,
       service_years = EXCLUDED.service_years, salary_basis_cents = EXCLUDED.salary_basis_cents,
       multiplier_bps = EXCLUDED.multiplier_bps,
       statement_benefit_cents = EXCLUDED.statement_benefit_cents,
       benefit_age = EXCLUDED.benefit_age, checked_on = EXCLUDED.checked_on, updated_at = now()`,
    [
      accountId,
      contribution?.kind === 'amount' ? contribution.cents : null,
      contribution?.kind === 'percent' ? toBps(contribution.percent) : null,
      toBps(plan.employerContributionPercent),
      plan.grossPayCents,
      plan.payCadence,
      plan.serviceYears,
      plan.salaryBasisMonthlyCents,
      toBps(plan.multiplierPercent),
      plan.statementBenefitMonthlyCents,
      plan.benefitAge,
      plan.checkedOn,
    ],
  )
}
