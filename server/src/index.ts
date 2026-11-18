// Starts Leeway: migrates the database, serves the app and syncs banks on a timer.

import { AnthropicSummaryWriter } from './ai/anthropic.js'
import { PlaidProvider } from './bank/plaid.js'
import { loadConfig } from './config.js'
import type { AppContext } from './context.js'
import { migrate } from './db/migrate.js'
import { createPool } from './db/pool.js'
import { addSummaryWidget } from './domain/dashboardUpgrade.js'
import { syncAll } from './domain/sync.js'
import { upgradeStarterSet } from './domain/starterUpgrade.js'
import { buildApp } from './http/app.js'

const config = loadConfig()
const db = createPool(config.databaseUrl, config.databaseSsl)
await migrate(db)
// One-time data upgrades run after the schema is current and before serving.
await upgradeStarterSet(db)
await addSummaryWidget(db)

const ctx: AppContext = {
  db,
  config,
  bank: config.plaid ? new PlaidProvider(config.plaid) : null,
  writer: config.anthropic ? new AnthropicSummaryWriter(config.anthropic) : null,
  now: () => new Date(),
}

const app = await buildApp(ctx, { logger: true })

// Webhooks keep banks current, but a periodic sync is the safety net for
// missed webhooks and for installs without a public URL.
let syncing = false
if (ctx.bank && config.syncIntervalMinutes > 0) {
  setInterval(() => {
    if (syncing) return
    syncing = true
    syncAll(ctx)
      .catch((error) => app.log.error({ err: error }, 'Scheduled sync failed'))
      .finally(() => {
        syncing = false
      })
  }, config.syncIntervalMinutes * 60_000).unref()
}

const shutdown = async () => {
  await app.close()
  await db.end()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await app.listen({ port: config.port, host: config.host })
if (!ctx.bank) {
  app.log.warn('Bank sync is off: set PLAID_CLIENT_ID and PLAID_SECRET to turn it on.')
}
