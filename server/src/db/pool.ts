// The Postgres pool, how column types are read, and transactions.

import pg from 'pg'
import { messageOf } from '../errors.js'

/**
 * Anything that can run a query: the pool itself, or a single client checked
 * out for a transaction. Repository functions accept this so the same code
 * works inside and outside a transaction.
 */
export type Db = pg.Pool | pg.PoolClient

// By default pg returns bigint (int8) as a string, because JavaScript numbers
// lose precision past 2^53. Cents for a personal budget never get near that,
// so parse them as numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value))
// DATE columns would otherwise become JS Date objects at local midnight, which
// can shift a day across time zones. Keep them as "YYYY-MM-DD" strings.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value)
// numeric (used for percentages like APR) arrives as a string; numbers are fine here.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value))

export function createPool(connectionString: string, ssl: boolean): pg.Pool {
  return new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  })
}

/** Runs `work` inside BEGIN/COMMIT, rolling back if it throws. */
export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Anything that can be asked a question: the pool, or a stand-in in tests. */
interface Queryable {
  query(sql: string): Promise<unknown>
}

/**
 * Waits until the database answers. On a fresh deploy the database often
 * starts alongside the app, so the first connection can be refused for a few
 * seconds; waiting here beats crashing and being restarted. Gives up with a
 * plain message after `attempts` tries.
 */
export async function waitForDatabase(
  db: Queryable,
  { attempts = 30, delayMs = 1000 }: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.query('SELECT 1')
      return
    } catch (error) {
      if (attempt >= attempts) {
        throw new Error(
          `Could not reach the database after ${attempts} tries (${messageOf(error)}). Check DATABASE_URL and that the database is running.`,
          { cause: error },
        )
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
