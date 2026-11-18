// Configuration from environment variables, read and checked once at startup.

import { z } from 'zod'
import type { ProxyTrust } from './http/proxyTrust.js'

/** An email address with no spaces or angle brackets in it. */
const ADDRESS = String.raw`[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+`

/**
 * A sender: an address, or a name and an address in angle brackets. One
 * line, with no quotes or brackets in the name, so it cannot carry anything else.
 */
const MAIL_FROM_PATTERN = new RegExp(`^(?:${ADDRESS}|[^<>"\\r\\n]+ <${ADDRESS}>)$`)

/**
 * All configuration comes from environment variables, validated once at
 * startup so a missing or malformed value fails loudly with a clear message
 * instead of surfacing later as a confusing runtime error.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (a Postgres connection string)'),
  ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'ENCRYPTION_KEY must be 64 hex characters (generate one with: openssl rand -hex 32)',
    ),
  PUBLIC_URL: z.url().optional(),
  // Spaces and dashes are ignored when the code is typed, so they do not count here.
  SETUP_CODE: z
    .string()
    .refine(
      (code) => code.replace(/[\s-]/g, '').length >= 12,
      'SETUP_CODE needs 12 characters or more',
    )
    .optional(),
  TRUST_PROXY: z.coerce
    .number()
    .int()
    .min(0, 'TRUST_PROXY is the number of proxies in front of Leeway, like 1')
    .max(10, 'TRUST_PROXY is the number of proxies in front of Leeway, like 1')
    .optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PLAID_COUNTRY_CODES: z.string().default('US'),
  PLAID_REDIRECT_URI: z.url().optional(),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(360),
  DATABASE_SSL: z.enum(['true', 'false']).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  SUMMARY_MODEL: z.string().default('claude-opus-5-5'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z
    .string()
    .regex(
      MAIL_FROM_PATTERN,
      'MAIL_FROM must be an email address, like leeway@example.com or Leeway <leeway@example.com>',
    )
    .optional(),
})

export interface PlaidConfig {
  clientId: string
  secret: string
  env: 'sandbox' | 'production'
  countryCodes: string[]
  redirectUri: string | null
}

export interface AnthropicConfig {
  apiKey: string
  /** The Claude model that writes the dashboard summary. */
  model: string
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
  /** Which proxies to believe about the client's address and protocol (see proxyTrust.ts). */
  trustProxy: ProxyTrust
  /** Null until both Plaid keys are set; the app still runs and explains what to add. */
  plaid: PlaidConfig | null
  /** How often to sync every bank in the background. 0 turns it off. */
  syncIntervalMinutes: number
  /** Null until ANTHROPIC_API_KEY is set; the summary then uses Leeway's own words. */
  anthropic: AnthropicConfig | null
  /** Null until RESEND_API_KEY and MAIL_FROM are both set; the weekly email is then unavailable. */
  mail: MailConfig | null
}

/** Drops variables set to nothing, like `PUBLIC_URL=` left blank in a .env file, so defaults apply. */
function withoutBlanks(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value?.trim()))
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(withoutBlanks(env))
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
    )
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`)
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
): Pick<Config, 'plaid' | 'anthropic' | 'mail'> {
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
    anthropic: e.ANTHROPIC_API_KEY ? { apiKey: e.ANTHROPIC_API_KEY, model: e.SUMMARY_MODEL } : null,
    mail: e.RESEND_API_KEY && e.MAIL_FROM ? { apiKey: e.RESEND_API_KEY, from: e.MAIL_FROM } : null,
  }
}

function isLocalDatabase(url: string): boolean {
  const host = new URL(url).hostname
  // Railway's private network (*.railway.internal) is already isolated and does not use TLS.
  return ['localhost', '127.0.0.1', 'db', 'postgres'].includes(host) || host.endsWith('.internal')
}
