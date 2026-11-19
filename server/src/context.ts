// The context every action runs with.

import type pg from 'pg'
import type { Config } from './config.js'
import type { SummaryWriter } from './ai/writer.js'
import type { BankProvider } from './bank/provider.js'
import type { PaystubReader } from './domain/paystubs/reader.js'
import type { EmailSender } from './mail/sender.js'
import type { PushSender } from './push/sender.js'

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
  /** Null until ANTHROPIC_API_KEY is set; the summary then uses Leeway's own words. */
  writer: SummaryWriter | null
  /** Null until ANTHROPIC_API_KEY is set; paystub import is then hidden. */
  paystubs: PaystubReader | null
  /** Null until RESEND_API_KEY and MAIL_FROM are set; the weekly email is then unavailable. */
  mailer: EmailSender | null
  /** Sends Web Push to the owner's devices. Always there: push needs no configuration. */
  push: PushSender
  /**
   * Called when a bank's data changed (a sync, a new link, a webhook), so the
   * inbox and pushes catch up soon after. Unset where nothing listens, as in tests.
   */
  afterBankUpdate?: () => void
  now: () => Date
}
