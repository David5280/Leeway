import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'

/** Works from both src/db (tsx) and dist/src/db (built), since migrations/ sits beside src/. */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))

// Any constant works; it just has to be the same for every process so two
// instances starting at once do not run the same migration twice.
const MIGRATION_LOCK_ID = 727_000_001

/**
 * Applies every .sql file in migrations/ that has not run yet, in filename
 * order, each in its own transaction. Applied files are recorded in
 * schema_migrations, so running this again is a no-op (idempotent).
 */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const applied = new Set(rows.map((row) => row.name))

    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort()
    const ran: string[] = []
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(`${dir}/${file}`, 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error })
      }
      ran.push(file)
    }
    return ran
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {})
    client.release()
  }
}
