// Whether an account's balance counts, shared by the server and the web app
// (web/src/lib/accounts.ts re-exports these), so a screen never adds up an
// account the server leaves out. Imports nothing, so the web can bundle it.

/** The parts of an account that decide whether it counts. */
export interface SharingFacts {
  hidden: boolean
  /** When the bank stopped sharing the account (see unshared.ts), or null while it does. */
  unsharedAt: unknown
}

/**
 * Whether the bank still shares the account, so its balance is current.
 * An account added by hand always counts as shared.
 */
export const isShared = (account: Pick<SharingFacts, 'unsharedAt'>): boolean =>
  account.unsharedAt === null

/** Whether the account's balance counts toward totals: shown, and still shared. */
export const isCounted = (account: SharingFacts): boolean => !account.hidden && isShared(account)
