// npm run migrate: applies any database migrations not yet run.

import { loadConfig } from '../config.js'
import { migrate } from './migrate.js'
import { createPool } from './pool.js'

const config = loadConfig()
const pool = createPool(config.databaseUrl, config.databaseSsl)
try {
  const ran = await migrate(pool)
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.')
} finally {
  await pool.end()
}
