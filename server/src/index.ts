// Starts Leeway: migrates the database, serves the app and syncs banks on a timer.

import { AnthropicSummaryWriter } from './ai/anthropic.js'
import { PlaidProvider } from './bank/plaid.js'
import { configWarnings, loadConfig } from './config.js'
import type { AppContext } from './context.js'
import { migrate } from './db/migrate.js'
import { createPool, waitForDatabase } from './db/pool.js'
import { addSummaryWidget } from './domain/dashboardUpgrade.js'
import { syncAll } from './domain/sync.js'
import { upgradeStarterSet } from './domain/starterUpgrade.js'
import { buildApp } from './http/app.js'

const config = loadConfig()
const db = createPool(config.databaseUrl, config.databaseSsl)
await waitForDatabase(db)
// The schema is created and kept current on every start, so a fresh deploy needs no extra step.
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
// Optional settings left out are fine; say once what each one would turn on.
for (const warning of configWarnings()) app.log.warn(warning)
