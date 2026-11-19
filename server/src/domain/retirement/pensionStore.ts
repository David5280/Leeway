// Pensions in the database: each plan kept beside its account, and adding,
// attaching and changing one. The plan's shape and arithmetic are in
// pensions.ts; this module only stores and reads them.

import type pg from 'pg'
import { z } from 'zod'
import { withTransaction, type Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import { KIND_INFO, kindFitsType, type AccountKind } from '../accountKinds.js'
import {
  getAccount,
  insertManualAccount,
  listAccounts,
  updateAccount,
  type Account,
  type AccountPatch,
} from '../accounts.js'
import {
  EMPTY_PLAN,
  MAX_PENSIONS,
  pensionPlanSchema,
  type NewPension,
  type Pension,
  type PensionContribution,
  type PensionPlan,
  type PensionPlanPatch,
} from './pensions.js'

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
async function plansOf(db: Db, accountIds: string[]): Promise<Map<string, PensionPlan>> {
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

function pensionOf(account: Account, plan: PensionPlan | undefined): Pension {
  return {
    accountId: account.id,
    name: account.name,
    balanceCents: account.balanceCents,
    plan: plan ?? EMPTY_PLAN,
  }
}

/**
 * The pensions among these accounts, as listAccounts gives them, each with
 * its plan. An account marked as a pension with no plan entered yet gets an
 * empty one, so it still shows, asking for its details.
 */
export async function pensionsOf(db: Db, accounts: Account[]): Promise<Pension[]> {
  const pensionAccounts = accounts.filter((account) => account.kind === 'pension')
  const plans = await plansOf(
    db,
    pensionAccounts.map((account) => account.id),
  )
  return pensionAccounts.map((account) => pensionOf(account, plans.get(account.id)))
}

/** Writes a pension's whole plan, adding the row the first time. */
async function savePlan(db: Db, accountId: string, plan: PensionPlan): Promise<void> {
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

/** The pension on one account, or an error when the account is not a pension. */
async function getPension(db: Db, accountId: string): Promise<Pension> {
  const account = await getAccount(db, accountId)
  if (account.kind !== 'pension') {
    throw new AppError(
      'invalid_input',
      'This account is not a pension. Mark it as one first, or add a pension.',
    )
  }
  return pensionOf(account, (await plansOf(db, [accountId])).get(accountId))
}

/**
 * Holds the pensions still until the transaction ends, so two requests at
 * once cannot both pass the count check or overwrite each other's plan.
 * The id only has to differ from the migration lock's (db/migrate.ts).
 */
const PENSIONS_LOCK_ID = 727_000_002

async function lockPensions(db: Db): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [PENSIONS_LOCK_ID])
}

/** Refuses another pension once the owner has the most Leeway keeps. */
function checkRoomForPension(accounts: Account[]): void {
  const pensions = accounts.filter((account) => account.kind === 'pension').length
  if (pensions >= MAX_PENSIONS) {
    throw new AppError('invalid_input', `Leeway keeps up to ${MAX_PENSIONS} pensions`)
  }
}

/**
 * Adds a pension: an account added by hand, of kind pension, with its plan.
 * It is an investment-type account, the type banks give a pension, so its
 * balance, when known, counts as something the owner owns.
 */
export async function createPension(
  pool: pg.Pool,
  input: NewPension,
  currency: string,
): Promise<Pension> {
  return withTransaction(pool, async (db) => {
    await lockPensions(db)
    checkRoomForPension(await listAccounts(db))
    const { name, balanceCents, ...plan } = input
    const account = await insertManualAccount(db, {
      name,
      type: 'investment',
      subtype: 'pension',
      balanceCents,
      creditLimitCents: null,
      currency,
      kind: 'pension',
    })
    await savePlan(db, account.id, plan)
    return getPension(db, account.id)
  })
}

/**
 * The kinds of account that may turn out to be a pension: a bank may report
 * one as retirement or investing, or as something Leeway cannot place.
 */
const MAY_BE_PENSION: readonly AccountKind[] = ['retirement', 'investment', 'other', 'pension']

/** Attaching a plan to an account Leeway already has. */
export const attachPensionSchema = pensionPlanSchema.extend({ accountId: z.uuid() })

export type AttachPension = z.infer<typeof attachPensionSchema>

/**
 * Records a pension's plan on an account Leeway already has, such as a
 * pension linked from the bank, instead of adding a second account for it.
 * The account becomes a pension, so its balance pays the benefit and is not
 * counted again as savings.
 */
export async function attachPension(pool: pg.Pool, input: AttachPension): Promise<Pension> {
  return withTransaction(pool, async (db) => {
    await lockPensions(db)
    const { accountId, ...plan } = input
    const account = await getAccount(db, accountId)
    if (!MAY_BE_PENSION.includes(account.kind) || !kindFitsType('pension', account.type)) {
      throw new AppError(
        'invalid_input',
        `A ${KIND_INFO[account.kind].noun} cannot be a pension. Choose a retirement or investment account.`,
      )
    }
    // A hidden account stays out of every total, so a pension on it would vanish.
    // The owner hid it on purpose, so Leeway asks rather than showing it again.
    if (account.hidden) {
      throw new AppError(
        'invalid_input',
        `${account.name} is hidden, so a pension on it would not count. Show it under Settings, Accounts first.`,
      )
    }
    if (account.kind !== 'pension') {
      checkRoomForPension(await listAccounts(db))
      await updateAccount(db, accountId, { kind: 'pension' })
    }
    await savePlan(db, accountId, plan)
    return getPension(db, accountId)
  })
}

/**
 * Changes an account, as update_account does. Marking one a pension takes the
 * pensions lock and a free place, as adding one does, so the limit holds
 * however a pension is made.
 */
export async function updateAccountWithinPensionLimit(
  pool: pg.Pool,
  id: string,
  patch: AccountPatch,
): Promise<Account> {
  if (patch.kind !== 'pension') return updateAccount(pool, id, patch)
  return withTransaction(pool, async (db) => {
    await lockPensions(db)
    // One counted as a pension already, such as one linked from the bank, takes no new place.
    if ((await getAccount(db, id)).kind !== 'pension') checkRoomForPension(await listAccounts(db))
    return updateAccount(db, id, patch)
  })
}

/**
 * A merged plan checked as a whole, so no caller can store one the pension
 * form would refuse, such as a contribution above the limit. Its first
 * problem is the error, in the schema's own plain words.
 */
function checkedPlan(plan: PensionPlan): PensionPlan {
  const checked = pensionPlanSchema.safeParse(plan)
  if (checked.success) return checked.data
  throw new AppError('invalid_input', checked.error.issues[0]!.message)
}

/**
 * Changes some of a pension's plan details inside a transaction the caller
 * holds, such as saving a paystub; the rest stay as they are.
 */
export async function patchPension(
  db: Db,
  accountId: string,
  patch: PensionPlanPatch,
): Promise<Pension> {
  await lockPensions(db)
  const current = await getPension(db, accountId)
  await savePlan(db, accountId, checkedPlan({ ...current.plan, ...patch }))
  return getPension(db, accountId)
}

/** Changes some of a pension's plan details; the rest stay as they are. */
export async function updatePension(
  pool: pg.Pool,
  accountId: string,
  patch: PensionPlanPatch,
): Promise<Pension> {
  return withTransaction(pool, (db) => patchPension(db, accountId, patch))
}
