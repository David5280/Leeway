// Starts Leeway: migrates the database, serves the app, and on timers syncs
// banks, sends notifications and sends the weekly email.

import { aiServices } from './ai/services.js'
import { PlaidProvider } from './bank/plaid.js'
import { ConfigError, loadConfig, type Config } from './config.js'
import type { AppContext } from './context.js'
import { migrate } from './db/migrate.js'
import { createPool, waitForDatabase } from './db/pool.js'
import { alertLogLine, changedLinesOnly } from './domain/alerts.js'
import { CALENDAR_CHECK_MINUTES, refreshIfStale } from './domain/calendar/store.js'
import { addFlowsWidget, addSummaryWidget, leadWithLeeway } from './domain/dashboardUpgrade.js'
import {
  NOTIFIER_MINUTES,
  NOTIFY_AFTER_SYNC_MS,
  runNotifier,
} from './domain/notifications/notifier.js'
import { getOwner } from './domain/owner.js'
import { getSettings } from './domain/settings.js'
import { catchUpPurchaseDates, purchaseDatesSummary } from './domain/purchaseDates.js'
import { syncAll } from './domain/sync.js'
import { upgradeStarterSet } from './domain/starterUpgrade.js'
import { sendWeeklyEmailIfDue, WEEKLY_EMAIL_CHECK_MINUTES } from './domain/weeklyEmail/send.js'
import { buildApp } from './http/app.js'
import { todayIn } from './lib/dates.js'
import { coalesced, repeatEvery } from './lib/repeat.js'
import { generateSetupCode, setupReminder, type SetupCode } from './lib/setupCode.js'
import { MINUTE_MS } from './lib/time.js'
import { ResendSender } from './mail/resend.js'
import { keysReplacedLine, loadVapidKeys } from './push/keys.js'
import { WebPushSender } from './push/sender.js'
import { configWarnings, explainConfigError } from './startupMessages.js'

/** The configuration, or a plain explanation in the log and an exit when a setting is wrong. */
function configOrExit(): Config {
  try {
    return loadConfig()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    // A sentence for whoever reads the deploy log, instead of a stack trace.
    // eslint-disable-next-line no-console -- the server's logger does not exist yet
    console.error(explainConfigError(error, process.env))
    process.exit(1)
  }
}

const config = configOrExit()
const db = createPool(config.databaseUrl, config.databaseSsl)
await waitForDatabase(db)
// The schema is created and kept current on every start, so a fresh deploy needs no extra step.
await migrate(db)
// One-time data upgrades run after the schema is current and before serving.
await upgradeStarterSet(db)
await addSummaryWidget(db)
await leadWithLeeway(db)
await addFlowsWidget(db)

const now = () => new Date()
const ctx: AppContext = {
  db,
  config,
  bank: config.plaid ? new PlaidProvider(config.plaid) : null,
  // AI calls come only from requests and from timers set up after buildApp, so
  // `app` exists before this can report.
  ...aiServices(config, db, now, (error, step) =>
    app.log.warn({ err: error }, `Could not ${step}; the next AI call will try again.`),
  ),
  mailer: config.mail ? new ResendSender(config.mail) : null,
  push: new WebPushSender({
    keys: () => loadVapidKeys(db, config.encryptionKey),
    publicUrl: config.publicUrl,
  }),
  now,
}

// Until the owner account exists, creating it takes this code, shown only to
// whoever can read the server log, so a stranger who finds the address first
// cannot claim the install.
const setup: SetupCode = config.setupCode
  ? { code: config.setupCode, from: 'variable' }
  : { code: generateSetupCode(), from: 'log' }
const app = await buildApp(ctx, { logger: true, setupCode: setup.code })
// The push key pair is made on first start and kept encrypted; nothing to configure.
await loadVapidKeys(db, config.encryptionKey, (removed) => app.log.warn(keysReplacedLine(removed)))

/**
 * Moves transactions from banks linked before Leeway used purchase dates onto
 * the day of purchase. Each bank is corrected once; a bank that cannot be
 * reached is tried again by the next call.
 */
async function catchUpDates(): Promise<void> {
  const summary = purchaseDatesSummary(await catchUpPurchaseDates(ctx))
  if (summary) app.log.info(summary)
}

/** Says in the log how many accounts are overdrawn, low or charged fees: counts only, and only when they change. */
const logChangedAlerts = changedLinesOnly((line) => app.log.info(line))
async function logAlerts(): Promise<void> {
  const settings = await getSettings(db)
  logChangedAlerts(await alertLogLine(db, settings, todayIn(settings.timeZone, ctx.now())))
}

/** Brings the inbox up to date and sends any push owed; logs only what went out. */
async function notify(): Promise<void> {
  const outcome = await runNotifier(ctx)
  if (outcome === 'sent') app.log.info('Sent a push notification')
}

/** After any sync (on a timer, from a webhook, by hand or from a new link), one check soon. */
const notifySoon = coalesced(
  notify,
  (error) => app.log.error({ err: error }, 'Notifications check failed'),
  NOTIFY_AFTER_SYNC_MS,
)
ctx.afterBankUpdate = notifySoon

// The inbox follows the data, and pushes wait out quiet hours, so the notifier
// runs on its own timer as well as after each sync. The first run is at start.
repeatEvery(
  NOTIFIER_MINUTES * MINUTE_MS,
  notify,
  (error) => app.log.error({ err: error }, 'Notifications check failed'),
  { runNow: true },
)

// Webhooks keep banks current, but a periodic sync is the safety net for
// missed webhooks and for installs without a public URL.
if (ctx.bank && config.syncIntervalMinutes > 0) {
  repeatEvery(
    config.syncIntervalMinutes * MINUTE_MS,
    async () => {
      await syncAll(ctx)
      await catchUpDates()
      await logAlerts()
      // Fresh balances may be news: tell the owner now, not at the next tick.
      notifySoon()
    },
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
      if (outcome === 'failed') app.log.warn('The weekly email failed; see Settings, then Email')
    },
    (error) => app.log.error({ err: error }, 'Weekly email check failed'),
    { runNow: true },
  )
}

// A linked calendar is read again once its last read is a few hours old, so
// the forecast follows it. A failure is kept for Settings to show; the log
// line never carries the calendar's address, which is a secret.
repeatEvery(
  CALENDAR_CHECK_MINUTES * MINUTE_MS,
  async () => {
    const { timeZone } = await getSettings(db)
    await refreshIfStale(db, { key: config.encryptionKey, timeZone, now: ctx.now() })
  },
  () => app.log.warn('Reading the linked calendar failed; it is tried again later'),
  { runNow: true },
)

const shutdown = async () => {
  await app.close()
  await db.end()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await app.listen({ port: config.port, host: config.host })
// In the background, so a slow bank never holds up serving the app.
catchUpDates().catch((error: unknown) =>
  app.log.error({ err: error }, 'Moving older transactions to purchase dates failed'),
)
logAlerts().catch((error: unknown) =>
  app.log.error({ err: error }, 'Counting account alerts failed'),
)
if (!(await getOwner(db))) app.log.warn(setupReminder(setup, config.publicUrl))
// Optional settings left out are fine; say once what each one would turn on.
for (const warning of configWarnings()) app.log.warn(warning)
