import { loadConfig } from '../config.js'
import { createPool } from '../db/pool.js'
import { resetPassword } from '../domain/owner.js'

const config = loadConfig()
const pool = createPool(config.databaseUrl, config.databaseSsl)
try {
  const { email, password } = await resetPassword(pool)
  console.log(`Password for ${email} reset. Every device is signed out.`)
  console.log(
    `Sign in with this temporary password, then change it in Customize:\n\n  ${password}\n`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await pool.end()
}
