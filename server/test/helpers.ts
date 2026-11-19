import pg from 'pg'
import type { SummaryWriter } from '../src/ai/writer.js'
import type { BankProvider } from '../src/bank/provider.js'
import type { AiGateway } from '../src/domain/ai/gateway.js'
import type { PaystubReader } from '../src/domain/paystubs/reader.js'
import type { EmailSender } from '../src/mail/sender.js'
import { loadConfig } from '../src/config.js'
import type { AppContext } from '../src/context.js'
import { migrate } from '../src/db/migrate.js'
import { createPool } from '../src/db/pool.js'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/leeway_test'

export const TEST_KEY_HEX = 'ab'.repeat(32)

/** The setup code every test app accepts for creating the owner account. */
export const TEST_SETUP_CODE = 'TEST-SETUP-CODE-1234'

/**
 * A context backed by a real, freshly migrated Postgres database. Tests run
 * against real SQL because most bugs in an app like this live in queries.
 */
export async function createTestContext(
  options: {
    now?: Date
    bank?: BankProvider | null
    ai?: AiGateway | null
    writer?: SummaryWriter | null
    paystubs?: PaystubReader | null
    mailer?: EmailSender | null
  } = {},
): Promise<AppContext & { setNow(date: Date): void }> {
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL })
  await admin.connect()
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await admin.end()

  const db = createPool(TEST_DATABASE_URL, false)
  await migrate(db)
  let now = options.now ?? new Date('2026-11-17T18:00:00Z')
  return {
    db,
    config: loadConfig({
      DATABASE_URL: TEST_DATABASE_URL,
      ENCRYPTION_KEY: TEST_KEY_HEX,
      SETUP_CODE: TEST_SETUP_CODE,
      NODE_ENV: 'test',
    }),
    bank: options.bank ?? null,
    ai: options.ai ?? null,
    writer: options.writer ?? null,
    paystubs: options.paystubs ?? null,
    mailer: options.mailer ?? null,
    now: () => now,
    setNow(date: Date) {
      now = date
    },
  }
}

/** Empties every table between tests, keeping the schema. */
export async function resetData(db: pg.Pool): Promise<void> {
  await db.query(
    `TRUNCATE owner, sessions, api_tokens, oauth_clients, oauth_requests, oauth_grants,
       oauth_codes, oauth_tokens, connections, accounts, categories, rules, transactions,
       bills, goals, goal_contributions, dismissed_recurring, applied_upgrades, ai_summaries,
       imports, pension_plans, paystubs, ai_usage, ai_spend_alerts, ai_unavailable_models CASCADE;
     UPDATE settings SET data = '{}';
     DELETE FROM weekly_email; INSERT INTO weekly_email (id) VALUES (true);`,
  )
}

let counter = 0

/** Inserts a bank connection and one account; returns the account id. */
export async function insertBankAccount(
  db: pg.Pool,
  fields: {
    name?: string
    type?: string
    subtype?: string | null
    balanceCents?: number | null
    currency?: string
    hidden?: boolean
    /** The account number's last digits, as Plaid sends them. */
    mask?: string
  } = {},
): Promise<{ accountId: string; connectionId: string }> {
  counter += 1
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO connections (provider, provider_item_id, access_token_encrypted, institution_name)
     VALUES ('plaid', $1, 'v1:x:y:z', 'Test Bank') RETURNING id`,
    [`item-${counter}`],
  )
  const connectionId = rows[0]!.id
  const account = await db.query<{ id: string }>(
    `INSERT INTO accounts (connection_id, provider_account_id, name, type, subtype, balance_cents,
       currency, hidden, mask)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      connectionId,
      `acct-${counter}`,
      fields.name ?? 'Checking',
      fields.type ?? 'depository',
      fields.subtype ?? null,
      fields.balanceCents === undefined ? 100000 : fields.balanceCents,
      fields.currency ?? 'USD',
      fields.hidden ?? false,
      fields.mask ?? null,
    ],
  )
  return { accountId: account.rows[0]!.id, connectionId }
}

/** Inserts a bank transaction (not categorized). */
export async function insertBankTransaction(
  db: pg.Pool,
  accountId: string,
  fields: {
    date: string
    name: string
    amountCents: number
    merchantName?: string | null
    pending?: boolean
    primary?: string | null
    detailed?: string | null
  },
): Promise<string> {
  counter += 1
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO transactions (account_id, provider_transaction_id, date, name, merchant_name,
       amount_cents, pending, provider_category_primary, provider_category_detailed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      accountId,
      `tx-${counter}`,
      fields.date,
      fields.name,
      fields.merchantName ?? null,
      fields.amountCents,
      fields.pending ?? false,
      fields.primary ?? null,
      fields.detailed ?? null,
    ],
  )
  return rows[0]!.id
}
