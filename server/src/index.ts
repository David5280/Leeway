// Starts Leeway: migrates the database, serves the app, and on timers syncs
// banks and sends the weekly email.

import { AnthropicSummaryWriter } from './ai/anthropic.js'
import { PlaidProvider } from './bank/plaid.js'
import { configWarnings, loadConfig } from './config.js'
import type { AppContext } from './context.js'
import { migrate } from './db/migrate.js'
import { createPool, waitForDatabase } from './db/pool.js'
import { addSummaryWidget } from './domain/dashboardUpgrade.js'
import { getOwner } from './domain/owner.js'
import { syncAll } from './domain/sync.js'
import { upgradeStarterSet } from './domain/starterUpgrade.js'
import { sendWeeklyEmailIfDue, WEEKLY_EMAIL_CHECK_MINUTES } from './domain/weeklyEmail/send.js'
import { buildApp } from './http/app.js'
import { repeatEvery } from './lib/repeat.js'
import { generateSetupCode } from './lib/setupCode.js'
import { MINUTE_MS } from './lib/time.js'
import { ResendSender } from './mail/resend.js'

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
  mailer: config.mail ? new ResendSender(config.mail) : null,
  now: () => new Date(),
}

// Until the owner account exists, creating it takes this code, shown only to
// whoever can read the server log, so a stranger who finds the address first
// cannot claim the install.
const setupCode = config.setupCode ?? generateSetupCode()
const app = await buildApp(ctx, { logger: true, setupCode })

// Webhooks keep banks current, but a periodic sync is the safety net for
// missed webhooks and for installs without a public URL.
if (ctx.bank && config.syncIntervalMinutes > 0) {
  repeatEvery(
    config.syncIntervalMinutes * MINUTE_MS,
    () => syncAll(ctx),
    (error) => app.log.error({ err: error }, 'Scheduled sync failed'),
  )
}

// The weekly email goes out within minutes of the owner's chosen hour. The
// first check runs at start, so a server that slept through it catches up.
if (ctx.mailer) {
  repeatEvery(
    WEEKLY_EMAIL_CHECK_MINUTES * MINUTE_MS,
    async () => {
      const outcome = await sendWeeklyEmailIfDue(ctx)
      if (outcome === 'sent') app.log.info('Sent the weekly email')
      if (outcome === 'failed') app.log.warn('The weekly email failed; see Customize, then Email')
    },
    (error) => app.log.error({ err: error }, 'Weekly email check failed'),
    { runNow: true },
  )
}

const shutdown = async () => {
  await app.close()
  await db.end()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await app.listen({ port: config.port, host: config.host })
if (!(await getOwner(db))) {
  app.log.warn(
    config.setupCode
      ? 'No account yet. Open Leeway and enter your SETUP_CODE to create it.'
      : `No account yet. Open Leeway and enter this setup code to create it: ${setupCode}`,
  )
}
// Optional settings left out are fine; say once what each one would turn on.
for (const warning of configWarnings()) app.log.warn(warning)
