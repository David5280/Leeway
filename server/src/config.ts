// Configuration from environment variables, read and checked once at startup.

import { z } from 'zod'
import type { AiJob } from './ai/jobs.js'
import type { ProxyTrust } from './http/proxyTrust.js'

/** An email address with no spaces or angle brackets in it. */
const ADDRESS = String.raw`[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+`

/**
 * A sender: an address, or a name and an address in angle brackets. One
 * line, with no quotes or brackets in the name, so it cannot carry anything else.
 */
const MAIL_FROM_PATTERN = new RegExp(`^(?:${ADDRESS}|[^<>"\\r\\n]+ <${ADDRESS}>)$`)

// What to set, said the same way whether a value is missing or malformed, so a
// fresh deploy that forgot one gets a sentence that says how to fix it.
// Each is shown after the variable's name.
const DATABASE_URL_HELP =
  'set it to a Postgres connection string (on Railway, ${{Postgres.DATABASE_URL}})'
const ENCRYPTION_KEY_HELP =
  'set it to 64 hex characters (generate one with: openssl rand -hex 32), and keep a copy somewhere safe'
const ADDRESS_HELP =
  'set it to a full web address, like https://leeway.example.com, or leave it empty'
const PROXY_HELP = 'set it to the number of proxies in front of Leeway, like 1, or leave it empty'

/**
 * All configuration comes from environment variables, validated once at
 * startup so a missing or malformed value fails loudly with a clear message
 * instead of surfacing later as a confusing runtime error.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string({ error: DATABASE_URL_HELP }).min(1, DATABASE_URL_HELP),
  ENCRYPTION_KEY: z
    .string({ error: ENCRYPTION_KEY_HELP })
    .regex(/^[0-9a-fA-F]{64}$/, ENCRYPTION_KEY_HELP),
  PUBLIC_URL: z.url(ADDRESS_HELP).optional(),
  // Spaces and dashes are ignored when the code is typed, so they do not count here.
  SETUP_CODE: z
    .string()
    .refine(
      (code) => code.replace(/[\s-]/g, '').length >= 12,
      'use 12 characters or more, or leave it empty and Leeway prints a code in its log',
    )
    .optional(),
  TRUST_PROXY: z.coerce
    .number(PROXY_HELP)
    .int(PROXY_HELP)
    .min(0, PROXY_HELP)
    .max(10, PROXY_HELP)
    .optional(),
  // Railway sets this, and RAILWAY_PROJECT_ID, on every service (see platformOf).
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z
    .enum(['sandbox', 'production'], {
      error: 'set it to sandbox (Plaid test banks) or production (your real banks)',
    })
    .default('sandbox'),
  PLAID_COUNTRY_CODES: z.string().default('US'),
  PLAID_REDIRECT_URI: z.url(ADDRESS_HELP).optional(),
  SYNC_INTERVAL_MINUTES: z.coerce
    .number('set it to a number of minutes, like 360, or 0 to turn background sync off')
    .int('set it to a whole number of minutes, like 360')
    .min(0, 'set it to a number of minutes, like 360, or 0 to turn background sync off')
    .default(360),
  DATABASE_SSL: z
    .enum(['true', 'false'], { error: 'set it to true or false, or leave it empty' })
    .optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Each fixes one job's model, over the owner's pick in Settings (ai/jobs.ts).
  SUMMARY_MODEL: z.string().optional(),
  PAYSTUB_MODEL: z.string().optional(),
  CHAT_MODEL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z
    .string()
    .regex(
      MAIL_FROM_PATTERN,
      'MAIL_FROM must be an email address, like leeway@example.com or Leeway <leeway@example.com>',
    )
    .optional(),
})

/** What Leeway runs on, so messages can say where its settings and log are. */
export type Platform = 'railway' | 'docker' | 'other'

/** A setting that is missing or malformed, by its variable name. */
export interface ConfigProblem {
  name: string
  message: string
}

/** Thrown by loadConfig when a setting is wrong; startupMessages.ts says how to fix it. */
export class ConfigError extends Error {
  constructor(readonly problems: ConfigProblem[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  ${p.name}: ${p.message}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

export interface PlaidConfig {
  clientId: string
  secret: string
  env: 'sandbox' | 'production'
  countryCodes: string[]
  redirectUri: string | null
}

export interface AnthropicConfig {
  apiKey: string
}

export interface MailConfig {
  apiKey: string
  /** The sender: an address on a domain verified with the provider. */
  from: string
}

export interface Config {
  env: 'development' | 'production' | 'test'
  port: number
  host: string
  databaseUrl: string
  databaseSsl: boolean
  encryptionKey: Buffer
  /** Public base URL without a trailing slash, used for webhooks and MCP links. */
  publicUrl: string | null
  /** The code that creates the owner account; null means a random one each start. */
  setupCode: string | null
  /** What Leeway runs on: Railway, Docker or anything else. */
  platform: Platform
  /** Which proxies to believe about the client's address and protocol (see proxyTrust.ts). */
  trustProxy: ProxyTrust
  /** Null until both Plaid keys are set; the app still runs and explains what to add. */
  plaid: PlaidConfig | null
  /** How often to sync every bank in the background. 0 turns it off. */
  syncIntervalMinutes: number
  /**
   * Null until ANTHROPIC_API_KEY is set; the summary then uses Leeway's own
   * words, and paystub import is turned off.
   */
  anthropic: AnthropicConfig | null
  /**
   * A model fixed for a job by SUMMARY_MODEL, PAYSTUB_MODEL or CHAT_MODEL, over the
   * owner's pick in Settings; null where the variable is not set.
   */
  modelOverrides: Record<AiJob, string | null>
  /** Null until RESEND_API_KEY and MAIL_FROM are both set; the weekly email is then unavailable. */
  mail: MailConfig | null
}

/** Drops variables set to nothing, like `PUBLIC_URL=` left blank in a .env file, so defaults apply. */
export function withoutBlanks(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value?.trim()))
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(withoutBlanks(env))
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => ({
        name: issue.path.join('.'),
        message: issue.message,
      })),
    )
  }
  const e = parsed.data

  const publicUrl =
    e.PUBLIC_URL ?? (e.RAILWAY_PUBLIC_DOMAIN ? `https://${e.RAILWAY_PUBLIC_DOMAIN}` : null)

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    // Hosted Postgres (Railway's public URL, Neon, Supabase) needs TLS; a local
    // Docker database does not. Default to TLS only for non-local hosts.
    databaseSsl: e.DATABASE_SSL ? e.DATABASE_SSL === 'true' : !isLocalDatabase(e.DATABASE_URL),
    encryptionKey: Buffer.from(e.ENCRYPTION_KEY, 'hex'),
    setupCode: e.SETUP_CODE ?? null,
    platform: platformOf(env),
    publicUrl: publicUrl ? publicUrl.replace(/\/+$/, '') : null,
    // Railway reaches the app only through its own edge proxy, one hop that
    // may connect from any address. Elsewhere, trust a proxy on a private network.
    trustProxy: e.TRUST_PROXY ?? (e.RAILWAY_PUBLIC_DOMAIN ? 1 : 'private-network'),
    syncIntervalMinutes: e.SYNC_INTERVAL_MINUTES,
    ...optionalServices(e),
  }
}

/** The outside services Leeway can use, each null until all of its keys are set. */
function optionalServices(
  e: z.infer<typeof envSchema>,
): Pick<Config, 'plaid' | 'anthropic' | 'modelOverrides' | 'mail'> {
  const plaid =
    e.PLAID_CLIENT_ID && e.PLAID_SECRET
      ? {
          clientId: e.PLAID_CLIENT_ID,
          secret: e.PLAID_SECRET,
          env: e.PLAID_ENV,
          countryCodes: e.PLAID_COUNTRY_CODES.split(',').map((code) => code.trim().toUpperCase()),
          redirectUri: e.PLAID_REDIRECT_URI ?? null,
        }
      : null
  return {
    plaid,
    anthropic: e.ANTHROPIC_API_KEY ? { apiKey: e.ANTHROPIC_API_KEY } : null,
    modelOverrides: {
      summary: e.SUMMARY_MODEL ?? null,
      paystub: e.PAYSTUB_MODEL ?? null,
      chat: e.CHAT_MODEL ?? null,
    },
    mail: e.RESEND_API_KEY && e.MAIL_FROM ? { apiKey: e.RESEND_API_KEY, from: e.MAIL_FROM } : null,
  }
}

/**
 * Where Leeway runs, from variables the platform sets: Railway sets its own on
 * every service, and Leeway's Dockerfile sets LEEWAY_DOCKER.
 */
export function platformOf(env: NodeJS.ProcessEnv = process.env): Platform {
  const set = withoutBlanks(env)
  if (set.RAILWAY_PROJECT_ID || set.RAILWAY_PUBLIC_DOMAIN) return 'railway'
  if (set.LEEWAY_DOCKER) return 'docker'
  return 'other'
}

function isLocalDatabase(url: string): boolean {
  const host = new URL(url).hostname
  // Railway's private network (*.railway.internal) is already isolated and does not use TLS.
  return ['localhost', '127.0.0.1', 'db', 'postgres'].includes(host) || host.endsWith('.internal')
}
