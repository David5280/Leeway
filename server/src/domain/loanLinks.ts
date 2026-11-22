// Which loan a home or car names, kept in accounts.loan_account_id, and
// keeping those ties true: a tie that stops fitting the rules (the loan is
// marked as a card, the home becomes something else) is undone, so equity
// never subtracts what is no longer a loan against it.

import type { Db } from '../db/pool.js'
import { AppError, isUniqueViolation } from '../errors.js'
import type { Account } from './accounts.js'
import { canCarryLoan, isLoan } from './ownedRules.js'

/** The loan each thing entered by hand names, by the thing's id. */
export async function loanLinks(db: Db): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; loanId: string }>(
    `SELECT id, loan_account_id AS "loanId" FROM accounts
     WHERE connection_id IS NULL AND loan_account_id IS NOT NULL`,
  )
  return new Map(rows.map((row) => [row.id, row.loanId]))
}

/** The loan a thing is tied to now, or null for none. */
export async function loanOf(db: Db, itemId: string): Promise<string | null> {
  const { rows } = await db.query<{ loanId: string | null }>(
    'SELECT loan_account_id AS "loanId" FROM accounts WHERE id = $1',
    [itemId],
  )
  return rows[0]?.loanId ?? null
}

/** The thing other than `itemId` that a loan is already tied to, if any. */
export async function loanHolder(db: Db, loanId: string, itemId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM accounts WHERE loan_account_id = $1 AND id <> $2',
    [loanId, itemId],
  )
  return rows[0]?.id ?? null
}

/**
 * Ties a loan to a thing, or unties it with null. The caller checks the rules
 * first. Two saves at once can both pass the check that the loan is free; the
 * unique index (033_owned_loan_unique.sql) then turns the later one away, and
 * this says so in words rather than as a server error.
 */
export async function saveLoanLink(db: Db, itemId: string, loanId: string | null): Promise<void> {
  try {
    await db.query('UPDATE accounts SET loan_account_id = $2 WHERE id = $1', [itemId, loanId])
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    throw new AppError(
      'invalid_input',
      'That loan was just tied to another home or car. Untie it there first.',
    )
  }
}

/**
 * Undoes the ties an account no longer fits, after it changed: to it, once it
 * is not a loan, and from it, once it is not a home or a car.
 */
export async function untieStaleLoans(db: Db, account: Account): Promise<void> {
  if (!isLoan(account)) {
    await db.query('UPDATE accounts SET loan_account_id = NULL WHERE loan_account_id = $1', [
      account.id,
    ])
  }
  if (!canCarryLoan(account)) await saveLoanLink(db, account.id, null)
}
