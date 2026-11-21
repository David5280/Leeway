// Against the real Postgres the server tests use (TEST_DATABASE_URL), with a
// database name of this test's own that matches the shards' pattern.

import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabase, dropDatabase } from './databases.ts'
import { withDatabase } from './plan.ts'

const SERVER = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/leeway_test'
const NAME = `leeway_e2e_unit_shard${process.pid}`

/** Whether the database exists on the server. */
async function exists(name: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: withDatabase(SERVER, 'postgres') })
  await client.connect()
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    return rowCount === 1
  } finally {
    await client.end()
  }
}

afterAll(async () => {
  await dropDatabase(SERVER, NAME)
})

// Making a database waits on the disk, which can be slow on a busy machine.
describe('createDatabase and dropDatabase', { timeout: 30_000 }, () => {
  it('create a database, reuse one left behind, and drop it', async () => {
    await createDatabase(SERVER, NAME)
    expect(await exists(NAME)).toBe(true)
    // A database left by an earlier run is reused: the test server empties it.
    await createDatabase(SERVER, NAME)
    await dropDatabase(SERVER, NAME)
    expect(await exists(NAME)).toBe(false)
    // Dropping one that is gone already is not an error.
    await dropDatabase(SERVER, NAME)
  })

  it('drop a database that a stopped server left a connection open to', async () => {
    await createDatabase(SERVER, NAME)
    const lingering = new pg.Client({ connectionString: withDatabase(SERVER, NAME) })
    await lingering.connect()
    // The connection is closed from the server's side, so its error is expected.
    lingering.on('error', () => {})
    await dropDatabase(SERVER, NAME)
    expect(await exists(NAME)).toBe(false)
    await lingering.end().catch(() => {})
  })

  it.each(['leeway_test', 'leeway_e2e', 'leeway_e2e_shard1"; DROP DATABASE x; --', 'postgres'])(
    'refuse to touch "%s", which is not a shard database',
    async (name) => {
      await expect(createDatabase(SERVER, name)).rejects.toThrow(`Refusing to touch database`)
      await expect(dropDatabase(SERVER, name)).rejects.toThrow(`Refusing to touch database`)
    },
  )

  it('pass on any other error from the server', async () => {
    const unreachable = 'postgres://postgres@localhost:1/leeway_e2e'
    await expect(createDatabase(unreachable, NAME)).rejects.toThrow()
  })
})
