// Starts a throwaway Leeway for the browser tests: wipes the e2e database,
// then runs the built server exactly as production does.

import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url?.includes('e2e')) {
  // The schema is dropped below, so refuse anything that is not plainly a test database.
  throw new Error(
    `Refusing to wipe ${url}: the browser tests need a database with "e2e" in its name`,
  )
}

const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
await client.end()

// The server migrates the empty database on start.
await import('../server/dist/src/index.js')
