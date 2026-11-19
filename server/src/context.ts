// The context every action runs with.

import type pg from 'pg'
import type { Config } from './config.js'
import type { SummaryWriter } from './ai/writer.js'
import type { BankProvider } from './bank/provider.js'
import type { AiGateway } from './domain/ai/gateway.js'
import type { PaystubReader } from './domain/paystubs/reader.js'
import type { EmailSender } from './mail/sender.js'

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
  /**
   * The AI usage layer every paid model call goes through. Null until
   * ANTHROPIC_API_KEY is set, and so are the writer and the paystub reader.
   */
  ai: AiGateway | null
  /** Null until ANTHROPIC_API_KEY is set; the summary then uses Leeway's own words. */
  writer: SummaryWriter | null
  /** Null until ANTHROPIC_API_KEY is set; paystub import is then hidden. */
  paystubs: PaystubReader | null
  /** Null until RESEND_API_KEY and MAIL_FROM are set; the weekly email is then unavailable. */
  mailer: EmailSender | null
  now: () => Date
  /**
   * True when an AI agent called, through the MCP endpoint. An agent never
   * reads the bank's own text (see mcp/withoutBankText.ts), so nothing it
   * asks may match that text either: a search for "4417" would otherwise say
   * which transactions carry an account's last digits.
   */
  agent?: boolean
}
