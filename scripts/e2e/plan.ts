// How a run is split into shards, and what each shard owns: a port, a
// database, a signed-in session file and folders for its results. Shards
// never share any of these, so they can run side by side, and so can the runs
// of several checkouts given different bases. Pure, and unit-tested.

import path from 'node:path'
import { UsageError } from './options.ts'

/**
 * Each shard pays for a server start and the setup tests before its first
 * real test, so a shard is only worth starting for at least this many tests.
 */
export const MIN_TESTS_PER_SHARD = 20

/** Everything one run writes, below the folder Playwright already keeps out of git. */
export const RUN_DIR = path.join('test-results', 'shards')

/** Each shard's signed-in session sits beside the plain run's e2e/.auth/owner.json. */
const AUTH_DIR = path.join('e2e', '.auth')

/** Postgres folds unquoted names to lower case and allows 63 bytes; keep names plain. */
const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,50}$/

export interface Shard {
  /** 1-based, as Playwright's --shard=index/total counts. */
  index: number
  total: number
  port: number
  databaseName: string
  databaseUrl: string
  /** The session setup.spec.ts saves and every later test of this shard signs in with. */
  authFile: string
  /** Playwright's output folder (traces and screenshots), emptied by Playwright at the start. */
  outputDir: string
  /** The blob report merged with the other shards' after the run. */
  blobFile: string
  /** Everything the shard's Playwright prints. */
  logFile: string
}

/** How many shards to run for this many tests: enough to share them out, never more than allowed. */
export function shardCount(maxShards: number, testCount: number): number {
  return Math.max(1, Math.min(maxShards, Math.ceil(testCount / MIN_TESTS_PER_SHARD)))
}

/**
 * The database name the shards are named after, from the base URL. The test
 * server wipes its database and refuses one without "e2e" in its name, so
 * that is checked here too, before anything is created.
 */
export function baseDatabaseName(databaseUrl: string): string {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new UsageError(`E2E_DATABASE_URL is not a URL: "${databaseUrl}".`)
  }
  const name = decodeURIComponent(url.pathname.slice(1))
  if (!DATABASE_NAME.test(name) || !name.includes('e2e')) {
    throw new UsageError(
      `E2E_DATABASE_URL must name a database in lower case letters, digits and _, with "e2e" in it, not "${name}".`,
    )
  }
  return name
}

/** The same server as `databaseUrl`, with another database. */
export function withDatabase(databaseUrl: string, name: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `/${name}`
  return url.toString()
}

/** Every shard of a run, each with its own port, database and files. */
export function planShards(total: number, portBase: number, databaseUrl: string): Shard[] {
  const base = baseDatabaseName(databaseUrl)
  return Array.from({ length: total }, (_, offset) => {
    const index = offset + 1
    const databaseName = `${base}_shard${index}`
    return {
      index,
      total,
      port: portBase + offset,
      databaseName,
      databaseUrl: withDatabase(databaseUrl, databaseName),
      authFile: path.join(AUTH_DIR, `shard-${index}.json`),
      outputDir: path.join(RUN_DIR, `shard-${index}`),
      blobFile: path.join(RUN_DIR, 'blobs', `shard-${index}.zip`),
      logFile: path.join(RUN_DIR, `shard-${index}.log`),
    }
  })
}

/**
 * The environment a shard's Playwright runs with: playwright.config.ts and
 * e2e/owner.ts read these, so the shard's server, database, session and
 * results are its own.
 */
export function shardEnv(shard: Shard): Record<string, string> {
  return {
    E2E_PORT: String(shard.port),
    E2E_DATABASE_URL: shard.databaseUrl,
    E2E_AUTH_FILE: shard.authFile,
    E2E_OUTPUT_DIR: shard.outputDir,
    PLAYWRIGHT_BLOB_OUTPUT_FILE: shard.blobFile,
  }
}
