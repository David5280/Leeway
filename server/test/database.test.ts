import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { migrate } from '../src/db/migrate.js'
import { createPool, withTransaction } from '../src/db/pool.js'
import { getSettings } from '../src/domain/settings.js'
import { createTestContext, resetData, TEST_DATABASE_URL } from './helpers.js'

let ctx: AppContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

describe('connection pool', () => {
  it('reads numbers, big integers and dates as plain values', async () => {
    const { rows } = await ctx.db.query<{ apr: unknown; cents: unknown; day: unknown }>(
      `SELECT 19.99::numeric AS apr, 9007199254740::bigint AS cents, '2026-11-17'::date AS day`,
    )
    expect(rows[0]).toEqual({ apr: 19.99, cents: 9007199254740, day: '2026-11-17' })
  })

  it('uses TLS only when asked, accepting hosted certificates', async () => {
    const hosted = createPool(TEST_DATABASE_URL, true)
    const local = createPool(TEST_DATABASE_URL, false)
    try {
      expect(hosted.options.ssl).toEqual({ rejectUnauthorized: false })
      expect(local.options.ssl).toBeUndefined()
    } finally {
      await Promise.all([hosted.end(), local.end()])
    }
  })

  it('rolls back everything a failed transaction did', async () => {
    const attempt = withTransaction(ctx.db, async (db) => {
      await db.query(`UPDATE settings SET data = '{"currency": "EUR"}'`)
      throw new Error('halfway failure')
    })

    await expect(attempt).rejects.toThrow('halfway failure')
    expect((await getSettings(ctx.db)).currency).toBe('USD')
  })
})

describe('migrations folder', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'leeway-migrations-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await ctx.db.query('DROP TABLE IF EXISTS migration_probe')
    await ctx.db.query(`DELETE FROM schema_migrations WHERE name LIKE '9%'`)
  })

  it('runs new files in name order once, skipping anything that is not SQL', async () => {
    await writeFile(join(dir, '902_fill.sql'), 'INSERT INTO migration_probe VALUES (1);')
    await writeFile(join(dir, '901_create.sql'), 'CREATE TABLE migration_probe (n int);')
    await writeFile(join(dir, 'README.md'), 'not a migration')

    expect(await migrate(ctx.db, dir)).toEqual(['901_create.sql', '902_fill.sql'])
    expect(await migrate(ctx.db, dir)).toEqual([])

    const { rows } = await ctx.db.query('SELECT n FROM migration_probe')
    expect(rows).toEqual([{ n: 1 }])
  })

  it('names the file that failed and leaves it unapplied', async () => {
    await writeFile(join(dir, '901_create.sql'), 'CREATE TABLE migration_probe (n int);')
    await writeFile(join(dir, '902_broken.sql'), 'INSERT INTO no_such_table VALUES (1);')

    await expect(migrate(ctx.db, dir)).rejects.toThrow(
      /^Migration 902_broken\.sql failed: relation "no_such_table" does not exist/,
    )

    const { rows } = await ctx.db.query<{ name: string }>(
      `SELECT name FROM schema_migrations WHERE name LIKE '9%'`,
    )
    expect(rows.map((r) => r.name)).toEqual(['901_create.sql'])
  })
})
