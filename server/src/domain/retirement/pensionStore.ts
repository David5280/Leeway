// Pensions in the database: each plan kept beside its account, and adding,
// attaching and changing one. The plan's shape and arithmetic are in
// pensions.ts, and its rows in pensionPlanRows.ts.

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
import { plansOf, savePlan } from './pensionPlanRows.js'
import {
  EMPTY_PLAN,
  MAX_PENSIONS,
  pensionPlanSchema,
  type NewPension,
  type Pension,
  type PensionPlan,
  type PensionPlanPatch,
} from './pensions.js'

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
 * Adds a pension inside a transaction the caller holds, such as saving a
 * paystub: an account added by hand, of kind pension, with its plan. It is an
 * investment-type account, the type banks give a pension, so its balance,
 * when known, counts as something the owner owns. Takes the pensions lock and
 * a free place, so the limit holds however a pension is made.
 */
export async function insertPension(db: Db, input: NewPension, currency: string): Promise<Pension> {
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
}

/** Adds a pension, all or nothing. */
export async function createPension(
  pool: pg.Pool,
  input: NewPension,
  currency: string,
): Promise<Pension> {
  return withTransaction(pool, (db) => insertPension(db, input, currency))
}

/**
 * The kinds of account that may turn out to be a pension: a bank may report
 * one as retirement or investing, or as something Leeway cannot place. One
 * that is a pension already is refused before this is asked.
 */
const MAY_BE_PENSION: readonly AccountKind[] = ['retirement', 'investment', 'other']

/** Attaching a plan to an account Leeway already has. */
export const attachPensionSchema = pensionPlanSchema.extend({ accountId: z.uuid() })

export type AttachPension = z.infer<typeof attachPensionSchema>

/**
 * Records a pension's plan on an account Leeway already has, inside a
 * transaction the caller holds, such as saving a paystub, instead of adding a
 * second account for it. The account becomes a pension, so its balance pays
 * the benefit and is not counted again as savings. Takes the pensions lock
 * and a free place. An account that is a pension already is refused in the
 * caller's words from keptPension, since the plan given would replace its
 * kept figures; those change through updating the pension instead.
 */
export async function attachPlan(
  db: Db,
  input: AttachPension,
  { keptPension }: { keptPension: (name: string) => string },
): Promise<Pension> {
  await lockPensions(db)
  const { accountId, ...plan } = input
  const account = await getAccount(db, accountId)
  // Checked under the lock, so no other request can make it a pension in between.
  if (account.kind === 'pension') {
    throw new AppError('invalid_input', keptPension(account.name))
  }
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
  checkRoomForPension(await listAccounts(db))
  await updateAccount(db, accountId, { kind: 'pension' })
  await savePlan(db, accountId, plan)
  return getPension(db, accountId)
}

/** Turning attach_pension away from a pension kept already, pointing to updating it instead. */
export const pensionAlready = (name: string) => `${name} is a pension already. Update it instead.`

/**
 * Records a pension's plan on an account Leeway already has, all or nothing.
 * One that is a pension already is refused, so its plan is never wiped.
 */
export async function attachPension(pool: pg.Pool, input: AttachPension): Promise<Pension> {
  return withTransaction(pool, (db) => attachPlan(db, input, { keptPension: pensionAlready }))
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
