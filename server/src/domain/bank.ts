// Reaching the bank for a stored connection: the configured provider, a
// connection's access token, and bank failures as errors the owner can read.

import { BankError, type BankProvider } from '../bank/provider.js'
import type { AppContext } from '../context.js'
import { AppError, messageOf, notFound } from '../errors.js'
import { decrypt } from '../lib/crypto.js'

/** The configured bank provider, or an error saying how to set one up. */
export function requireBank(ctx: AppContext): BankProvider {
  if (!ctx.bank) {
    throw new AppError(
      'not_configured',
      'Bank sync is not set up yet. Add PLAID_CLIENT_ID and PLAID_SECRET to this server and restart it.',
    )
  }
  return ctx.bank
}

export const UNREADABLE_TOKEN =
  "Leeway can no longer read this bank's saved login, which happens when ENCRYPTION_KEY changes. Remove the bank and link it again."

/**
 * A connection's bank access token, decrypted. It is stored encrypted and
 * never leaves the server. A token that will not decrypt (the key changed, or
 * the value was tampered with) is a bank failure the owner can act on, not a
 * crash: the bank shows as needing attention and can still be removed.
 */
export async function accessTokenOf(ctx: AppContext, connectionId: string): Promise<string> {
  const { rows } = await ctx.db.query<{ token: string }>(
    'SELECT access_token_encrypted AS token FROM connections WHERE id = $1',
    [connectionId],
  )
  if (!rows[0]) throw notFound('Connection')
  try {
    return decrypt(rows[0].token, ctx.config.encryptionKey)
  } catch {
    throw new BankError(UNREADABLE_TOKEN, true)
  }
}

/** A failed bank call as an error for the caller; errors already meant for them pass through. */
export function bankFailure(error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError('bank_error', messageOf(error))
}
