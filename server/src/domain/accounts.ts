// Accounts from banks and added by hand, with balances for net worth.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'
import { distinctAccountNames } from './accountName.js'
import { recategorize } from './categorize.js'
import {
  ACCOUNT_KINDS,
  choiceThatFits,
  kindFitsType,
  kindOf,
  type AccountKind,
} from './accountKinds.js'

export const ACCOUNT_TYPES = [
  'depository',
  'credit',
  'loan',
  'investment',
  'property',
  'other',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

/** Credit cards and loans are money owed; their balance counts against net worth. */
export const LIABILITY_TYPES: readonly AccountType[] = ['credit', 'loan']

export interface Account {
  id: string
  connectionId: string | null
  institutionName: string | null
  /**
   * The name shown everywhere: the owner's own, or the bank's short name and
   * the account's in plain case, like "Chase Total Checking" (see accountName.ts).
   */
  name: string
  /** The owner's own name for the account, or null for none. */
  nickname: string | null
  /** The account's name as the bank sends it, or as typed for one added by hand. */
  bankName: string
  mask: string | null
  type: AccountType
  subtype: string | null
  /** For credit and loan accounts, the amount owed. */
  balanceCents: number | null
  availableCents: number | null
  creditLimitCents: number | null
  currency: string
  hidden: boolean
  manual: boolean
  balanceUpdatedAt: string | null
  /** Yearly interest rate for a card or loan, such as 24.99. Banks rarely send it. */
  aprPercent: number | null
  /** The required monthly payment for a card or loan. */
  minimumPaymentCents: number | null
  /**
   * The owner's own low-balance warning: warn below this. Null follows the
   * default (see accountAlerts.ts) and 0 turns the warning off.
   */
  lowBalanceCents: number | null
  /** The owner's pick of kind; null follows the automatic one. */
  kindChoice: AccountKind | null
  /** What kind of account this is (see accountKinds.ts). */
  kind: AccountKind
}

const SELECT = `
  SELECT a.id, a.connection_id AS "connectionId", c.institution_name AS "institutionName",
    a.display_name AS nickname, a.name AS "bankName", a.mask, a.type, a.subtype,
    a.balance_cents AS "balanceCents", a.available_cents AS "availableCents",
    a.credit_limit_cents AS "creditLimitCents", a.currency, a.hidden,
    a.connection_id IS NULL AS manual, a.balance_updated_at AS "balanceUpdatedAt",
    a.apr_bps / 100.0 AS "aprPercent", a.minimum_payment_cents AS "minimumPaymentCents",
    a.low_balance_cents AS "lowBalanceCents", a.kind AS "kindChoice"
  FROM accounts a LEFT JOIN connections c ON c.id = a.connection_id`

/** An account as stored, before its name and kind are worked out. */
type AccountRow = Omit<Account, 'name' | 'kind'>

/**
 * Every account, hidden ones too, named side by side so no two share a name
 * (see accountName.ts) and with its kind worked out (see accountKinds.ts).
 * Oldest first, so adding an account never renames another.
 */
async function namedAccounts(db: Db): Promise<Account[]> {
  const { rows } = await db.query<AccountRow>(`${SELECT} ORDER BY a.created_at, a.id`)
  const names = distinctAccountNames(rows)
  return rows.map((row) => ({ ...row, name: names.get(row.id)!, kind: kindOf(row) }))
}

/** By kind of account, then by the name shown. Names are worked out here, so SQL cannot sort them. */
const inListOrder = (a: Account, b: Account) =>
  a.type.localeCompare(b.type) || a.name.localeCompare(b.name)

export async function listAccounts(db: Db, includeHidden = true): Promise<Account[]> {
  const accounts = await namedAccounts(db)
  return accounts.filter((account) => includeHidden || !account.hidden).sort(inListOrder)
}

export async function getAccount(db: Db, id: string): Promise<Account> {
  const account = (await namedAccounts(db)).find((one) => one.id === id)
  if (!account) throw notFound('Account')
  return account
}

/**
 * Each account's name by id, for anything that shows an account beside other
 * data: transactions, goals, debts, imports. The same names listAccounts gives.
 */
export async function accountNames(db: Db): Promise<Map<string, string>> {
  const accounts = await namedAccounts(db)
  return new Map(accounts.map((account) => [account.id, account.name]))
}

export const manualAccountInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  subtype: z.string().max(40).nullable().default(null),
  /** For a loan or card, what you owe, as a positive number. */
  balanceCents: z.number().int(),
  creditLimitCents: z.number().int().min(0).nullable().default(null),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
})

export async function createManualAccount(
  db: Db,
  input: z.infer<typeof manualAccountInputSchema>,
): Promise<Account> {
  return insertManualAccount(db, { ...input, kind: null })
}

/** What a manual account is stored with, for adding one of any kind. */
export interface ManualAccountRow {
  name: string
  type: AccountType
  subtype: string | null
  /** Null for an account whose balance the owner does not know, such as a pension. */
  balanceCents: number | null
  creditLimitCents: number | null
  currency: string
  /** The owner's pick of kind, or null to follow the automatic one. */
  kind: AccountKind | null
}

/** Adds an account by hand: through create_account, or as a pension (retirement/pensionStore.ts). */
export async function insertManualAccount(db: Db, row: ManualAccountRow): Promise<Account> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO accounts (name, type, subtype, balance_cents, credit_limit_cents, currency,
       kind, balance_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
    [
      row.name,
      row.type,
      row.subtype,
      row.balanceCents,
      row.creditLimitCents,
      row.currency,
      row.kind,
    ],
  )
  return getAccount(db, rows[0]!.id)
}

export const accountPatchSchema = z
  .object({
    /** Your own label for the account. Null goes back to the bank's name. */
    displayName: z.string().trim().min(1).max(80).nullable(),
    hidden: z.boolean(),
    /** Debt terms, for payoff plans. Any account can carry them; they matter for cards and loans. */
    aprPercent: z.number().min(0).max(100).multipleOf(0.01).nullable(),
    minimumPaymentCents: z.number().int().min(0).nullable(),
    /** Warn when the balance drops below this. Null follows the default; 0 turns it off. */
    lowBalanceCents: z.number().int().min(0).nullable(),
    /** What kind of account it is. Null goes back to the kind worked out from the bank. */
    kind: z.enum(ACCOUNT_KINDS).nullable(),
    // The rest only apply to manual accounts; bank accounts get them from the bank.
    balanceCents: z.number().int(),
    creditLimitCents: z.number().int().min(0).nullable(),
    type: z.enum(ACCOUNT_TYPES),
    subtype: z.string().max(40).nullable(),
  })
  .partial()

/**
 * Refuses a patch the account cannot take: bank-owned fields on a linked
 * account, or a kind that does not fit its type (a card marked as savings).
 */
function assertPatchFits(account: Account, patch: z.infer<typeof accountPatchSchema>): void {
  const manualOnly = (['balanceCents', 'creditLimitCents', 'type', 'subtype'] as const).filter(
    (key) => patch[key] !== undefined,
  )
  if (!account.manual && manualOnly.length) {
    throw new AppError(
      'invalid_input',
      `${manualOnly.join(', ')} come from the bank for linked accounts and cannot be edited`,
    )
  }
  if (patch.kind && !kindFitsType(patch.kind, patch.type ?? account.type)) {
    throw new AppError(
      'invalid_input',
      'A card or loan can only be a credit card, a loan or other, and an account you own cannot be either',
    )
  }
}

/**
 * The pick of kind a patch stores: the one it gives, if any. Otherwise a new
 * type drops a pick that no longer fits it, such as savings on a loan, so the
 * old pick cannot come back later. Undefined leaves the stored pick as it is.
 */
function kindToStore(
  account: Account,
  patch: z.infer<typeof accountPatchSchema>,
): AccountKind | null | undefined {
  if (patch.kind !== undefined || !patch.type) return patch.kind
  return choiceThatFits(account.kindChoice, patch.type)
}

export async function updateAccount(
  db: Db,
  id: string,
  patch: z.infer<typeof accountPatchSchema>,
): Promise<Account> {
  const account = await getAccount(db, id)
  assertPatchFits(account, patch)
  const kind = kindToStore(account, patch)
  await db.query(
    `UPDATE accounts SET
       display_name = CASE WHEN $2 THEN $3 ELSE display_name END,
       hidden = coalesce($4, hidden),
       balance_cents = coalesce($5, balance_cents),
       credit_limit_cents = CASE WHEN $6 THEN $7 ELSE credit_limit_cents END,
       type = coalesce($8, type),
       subtype = CASE WHEN $9 THEN $10 ELSE subtype END,
       balance_updated_at = CASE WHEN $5::bigint IS NULL THEN balance_updated_at ELSE now() END,
       apr_bps = CASE WHEN $11 THEN $12 ELSE apr_bps END,
       minimum_payment_cents = CASE WHEN $13 THEN $14 ELSE minimum_payment_cents END,
       low_balance_cents = CASE WHEN $15 THEN $16 ELSE low_balance_cents END,
       kind = CASE WHEN $17 THEN $18 ELSE kind END
     WHERE id = $1`,
    [
      id,
      patch.displayName !== undefined,
      patch.displayName ?? null,
      patch.hidden ?? null,
      patch.balanceCents ?? null,
      patch.creditLimitCents !== undefined,
      patch.creditLimitCents ?? null,
      patch.type ?? null,
      patch.subtype !== undefined,
      patch.subtype ?? null,
      patch.aprPercent !== undefined,
      // Stored in basis points: 24.99% is 2499.
      typeof patch.aprPercent === 'number' ? Math.round(patch.aprPercent * 100) : null,
      patch.minimumPaymentCents !== undefined,
      patch.minimumPaymentCents ?? null,
      patch.lowBalanceCents !== undefined,
      patch.lowBalanceCents ?? null,
      kind !== undefined,
      kind ?? null,
    ],
  )
  // A card counted or left out changes whether payments to it are transfers.
  const hiddenChanged = patch.hidden !== undefined && patch.hidden !== account.hidden
  if (hiddenChanged && account.type === 'credit') await recategorize(db)
  return getAccount(db, id)
}

export async function deleteManualAccount(db: Db, id: string): Promise<void> {
  const account = await getAccount(db, id)
  if (!account.manual) {
    throw new AppError(
      'invalid_input',
      'Linked bank accounts go away when you remove their bank connection; you can hide this one instead',
    )
  }
  await db.query('DELETE FROM accounts WHERE id = $1', [id])
}
