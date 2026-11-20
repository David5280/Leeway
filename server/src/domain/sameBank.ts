// Spotting a bank that is already connected, before it is linked a second time.
//
// Plaid counts an Item (one login at one bank) when its public token is
// exchanged for an access token, and on its free Trial plan every Item counts
// toward a fixed limit for good: removing one does not give its place back.
// So the check runs on what Plaid's window reports when it closes, before the
// exchange, while saying no still costs nothing.
//
// Plaid's guidance (plaid.com/docs/link/duplicate-items) is to compare the
// institution, then the accounts' names and masks. The same bank alone is not
// proof of a duplicate: two people, or a person and their business, can each
// have their own login there. So a match by bank asks the owner; matching
// accounts only make the question sound surer.

import type { Db } from '../db/pool.js'
import { AppError } from '../errors.js'
import type { Connection } from './connections.js'

/** The bank Plaid's window says was just picked. */
export interface PickedBank {
  id: string
  name: string
}

/** An account as Plaid's window lists it: its name and the last few digits of its number. */
export interface PickedAccount {
  name: string
  mask: string | null
}

/** A login already connected at the same bank. */
export interface ExistingLogin {
  connectionId: string
  institutionName: string | null
  status: Connection['status']
  /** Whether any account just picked is one this login already brings in. */
  sameAccounts: boolean
}

/** What the duplicate_bank error carries, so the app can offer to keep the login it has. */
export interface DuplicateBankDetails {
  institutionName: string
  logins: ExistingLogin[]
}

/** The same account as Plaid names it: the same name, ignoring case and spacing, and the same mask. */
export function sameAccount(a: PickedAccount, b: PickedAccount): boolean {
  // Without a mask, two accounts both called "Checking" say nothing.
  if (!a.mask || !b.mask || a.mask !== b.mask) return false
  return sameName(a.name, b.name)
}

/** The same account name, ignoring case and spacing. */
export function sameName(a: string, b: string): boolean {
  return normalized(a) === normalized(b)
}

const normalized = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * The logins already connected at a bank, oldest first. `exceptItemId` leaves
 * out one Plaid Item, for when the login just linked is itself saved already.
 */
export async function loginsAtBank(
  db: Db,
  institutionId: string | null,
  picked: PickedAccount[] = [],
  exceptItemId: string | null = null,
): Promise<ExistingLogin[]> {
  if (!institutionId) return []
  const { rows } = await db.query<{
    connectionId: string
    institutionName: string | null
    status: Connection['status']
    accounts: PickedAccount[]
  }>(
    `SELECT c.id AS "connectionId", c.institution_name AS "institutionName", c.status,
       coalesce(
         (SELECT json_agg(json_build_object('name', a.name, 'mask', a.mask))
          FROM accounts a WHERE a.connection_id = c.id),
         '[]'
       ) AS accounts
     FROM connections c
     WHERE c.institution_id = $1 AND c.provider_item_id IS DISTINCT FROM $2
     ORDER BY c.created_at`,
    [institutionId, exceptItemId],
  )
  return rows.map(({ accounts, ...login }) => ({
    ...login,
    sameAccounts: picked.some((p) => accounts.some((a) => sameAccount(p, a))),
  }))
}

/** The refusal the app answers with "keep the one I have" or a deliberate second login. */
export function duplicateBankError(bank: PickedBank, logins: ExistingLogin[]): AppError {
  const details: DuplicateBankDetails = { institutionName: bank.name, logins }
  const message = logins.some((login) => login.sameAccounts)
    ? `${bank.name} is already connected with these accounts. Keep the login you have, or reconnect it to repair it or add accounts.`
    : `${bank.name} is already connected. Keep the login you have, or confirm that this is a different login.`
  return new AppError('duplicate_bank', message, details)
}
