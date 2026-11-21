// Creates and drops the shards' databases. The test server empties its
// database when it starts (e2e/start-server.mjs), so a database left over
// from an earlier run is reused rather than refused.

import pg from 'pg'
import { withDatabase } from './plan.ts'

/** Postgres's error code for a database that already exists. */
const DUPLICATE_DATABASE = '42P04'

/** Only names planShards makes are ever created or dropped here, never real data. */
const SHARD_DATABASE = /^[a-z_][a-z0-9_]*e2e[a-z0-9_]*_shard\d+$/

function assertShardDatabase(name: string): void {
  if (!SHARD_DATABASE.test(name)) throw new Error(`Refusing to touch database "${name}"`)
}

/** Runs one statement on the server's maintenance database, where databases are made. */
async function onServer(databaseUrl: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: withDatabase(databaseUrl, 'postgres') })
  await client.connect()
  try {
    await client.query(statement)
  } finally {
    await client.end()
  }
}

/** Makes the database `name` on `databaseUrl`'s server, if it is not there yet. */
export async function createDatabase(databaseUrl: string, name: string): Promise<void> {
  assertShardDatabase(name)
  try {
    // The name is checked above, so it is safe to write into the statement.
    await onServer(databaseUrl, `CREATE DATABASE "${name}"`)
  } catch (error) {
    if ((error as { code?: string }).code !== DUPLICATE_DATABASE) throw error
  }
}

/** Drops the database `name`, closing any connection a stopped server left open. */
export async function dropDatabase(databaseUrl: string, name: string): Promise<void> {
  assertShardDatabase(name)
  await onServer(databaseUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
}
