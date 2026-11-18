// What Leeway says in its log when it starts: why it cannot start, and which
// optional features are off. Each message names the variable and where to set
// it, because the person reading a deploy log may never have seen a .env file.

import { platformOf, withoutBlanks, type ConfigError, type Platform } from './config.js'

/** Where to change a setting, and how to make Leeway pick it up, on each platform. */
export function whereToSet(platform: Platform): string {
  if (platform === 'railway') {
    return "in your Leeway service's Variables on Railway, then deploy the change"
  }
  if (platform === 'docker') return 'in your .env file, then run: docker compose up -d'
  return 'where Leeway reads its settings (your .env file or environment), then restart Leeway'
}

/**
 * The log message for settings that stop Leeway from starting: each problem on
 * its own line, then where to fix them.
 */
export function explainConfigError(error: ConfigError, env: NodeJS.ProcessEnv): string {
  const lines = error.problems.map((problem) => `  ${problem.name}: ${problem.message}`)
  const them = error.problems.length === 1 ? 'it' : 'them'
  return [
    "Leeway can't start until these settings are fixed:",
    ...lines,
    `Set ${them} ${whereToSet(platformOf(env))}.`,
  ].join('\n')
}

/**
 * Settings that are allowed but probably not what the owner meant, as
 * sentences for the server log. Leeway still starts; these only explain why
 * an optional feature is off or limited.
 */
export function configWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const set = withoutBlanks(env)
  const where = whereToSet(platformOf(env))
  const plaidKeys = ['PLAID_CLIENT_ID', 'PLAID_SECRET'].filter((name) => set[name])

  if (plaidKeys.length === 0) {
    return [
      `Bank sync is off, which is fine: accounts and transactions can be added by hand or imported from a CSV file. To turn it on, set PLAID_CLIENT_ID and PLAID_SECRET from dashboard.plaid.com/developers/keys ${where}.`,
    ]
  }
  if (plaidKeys.length === 1) {
    const missing = plaidKeys[0] === 'PLAID_CLIENT_ID' ? 'PLAID_SECRET' : 'PLAID_CLIENT_ID'
    return [`Bank sync is off: ${plaidKeys[0]} is set but ${missing} is not. Set both ${where}.`]
  }

  const warnings: string[] = []
  // PLAID_ENV defaults to sandbox, whose banks are all pretend ones.
  if (set.PLAID_ENV !== 'production') {
    warnings.push(
      `Bank sync uses Plaid's Sandbox, which has only test banks. To connect your real banks once Plaid gives you Production access, set PLAID_ENV to production and PLAID_SECRET to your Production secret ${where}.`,
    )
  }
  if (!set.PUBLIC_URL && !set.RAILWAY_PUBLIC_DOMAIN) {
    warnings.push(
      `PUBLIC_URL is not set, so banks cannot send updates as they happen and are synced on a timer instead. Set it to the address you open Leeway at, ${where}.`,
    )
  }
  return warnings
}
