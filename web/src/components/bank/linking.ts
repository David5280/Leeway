// What adding a bank needs besides its screens: the words shared by every
// place that shows banks, and reading what Plaid's window and the server say.

import type { PlaidLinkOnSuccessMetadata } from 'react-plaid-link'
import type { DuplicateBankDetails } from '../../../../server/src/domain/sameBank'
import { ApiError, type Connection, type Input } from '../../api/client'

export type { DuplicateBankDetails }

/**
 * The one line shown wherever banks are listed or added. Plaid's free Trial
 * plan counts every login it ever linked toward a fixed limit, and the limit
 * differs by account, so no number is given here.
 */
export const TRIAL_LIMIT_NOTE =
  "On Plaid's Trial plan, removed connections still count toward the limit, so use Reconnect instead of removing and re-adding a bank."

/** A bank linked in Plaid's window, ready for link_bank once the owner has said yes. */
export type PickedLink = Required<
  Pick<Input<'link_bank'>, 'publicToken' | 'institution' | 'accounts'>
>

/** What link_bank needs from Plaid's window: the token, and which bank and accounts were picked. */
export function pickedLink(publicToken: string, metadata: PlaidLinkOnSuccessMetadata): PickedLink {
  const { institution, accounts } = metadata
  return {
    publicToken,
    institution: institution ? { id: institution.institution_id, name: institution.name } : null,
    // Only the name and mask are compared; Plaid's account ids differ for every new login.
    accounts: accounts.map(({ name, mask }) => ({ name, mask })),
  }
}

/** The bank-already-connected refusal's details, or null for any other failure. */
export function duplicateOf(error: unknown): DuplicateBankDetails | null {
  if (!(error instanceof ApiError) || error.code !== 'duplicate_bank') return null
  const details = error.details as Partial<DuplicateBankDetails> | undefined
  // A refusal without its logins cannot offer to keep one, so it reads as a plain error.
  return details?.institutionName && Array.isArray(details.logins)
    ? (details as DuplicateBankDetails)
    : null
}

/** A connection's bank, for a sentence or a heading. */
export const bankName = (connection: Pick<Connection, 'institutionName'>) =>
  connection.institutionName ?? 'Bank'

/** How a connection is doing, in a few words. */
export function connectionHealth(connection: Pick<Connection, 'status' | 'lastError'>): string {
  if (connection.status === 'active') return 'Connected'
  if (connection.status === 'needs_reauth') return 'Needs you to sign in again'
  return connection.lastError ?? 'Sync failed'
}

/** Whether the owner must sign in again before the bank can sync; then Fix login, else Reconnect. */
export const needsLogin = (connection: Pick<Connection, 'status'>) =>
  connection.status === 'needs_reauth'
