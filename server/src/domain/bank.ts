// Reaching the bank for a stored connection: the configured provider, a
// connection's access token, and bank failures as errors the owner can read.

import type { BankProvider } from '../bank/provider.js'
import type { AppContext } from '../context.js'
import { AppError, notFound } from '../errors.js'
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

/** A connection's bank access token, decrypted. It is stored encrypted and never leaves the server. */
export async function accessTokenOf(ctx: AppContext, connectionId: string): Promise<string> {
  const { rows } = await ctx.db.query<{ token: string }>(
    'SELECT access_token_encrypted AS token FROM connections WHERE id = $1',
    [connectionId],
  )
  if (!rows[0]) throw notFound('Connection')
  return decrypt(rows[0].token, ctx.config.encryptionKey)
}

/** A failed bank call as an error for the caller; errors already meant for them pass through. */
export function bankFailure(error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError('bank_error', (error as Error).message)
}
