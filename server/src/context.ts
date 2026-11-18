// The context every action runs with.

import type pg from 'pg'
import type { Config } from './config.js'
import type { BankProvider } from './bank/provider.js'

/**
 * Everything an action needs to do its work. The web app and the MCP endpoint
 * build one per request, which keeps actions free of HTTP details and easy to
 * test with a real database and a fake bank.
 */
export interface AppContext {
  db: pg.Pool
  config: Config
  /** Null until Plaid keys are configured. */
  bank: BankProvider | null
  now: () => Date
}
