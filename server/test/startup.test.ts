// A fresh install starting up: clear messages for settings left out, and
// waiting for a database that is still starting.

import { describe, expect, it } from 'vitest'
import { configWarnings, loadConfig } from '../src/config.js'
import { waitForDatabase } from '../src/db/pool.js'

const required = { DATABASE_URL: 'postgres://localhost/leeway', ENCRYPTION_KEY: 'ab'.repeat(32) }

describe('required settings', () => {
  it('says how to set each one that is missing', () => {
    expect(() => loadConfig({})).toThrow(
      /DATABASE_URL: set it to a Postgres connection string \(on Railway, \$\{\{Postgres\.DATABASE_URL\}\}\)/,
    )
    expect(() => loadConfig({ DATABASE_URL: required.DATABASE_URL })).toThrow(
      /ENCRYPTION_KEY: set it to 64 hex characters \(generate one with: openssl rand -hex 32\)/,
    )
  })

  it('gives the same help for a malformed key', () => {
    expect(() => loadConfig({ ...required, ENCRYPTION_KEY: 'xyz' })).toThrow(
      /keep a copy somewhere safe/,
    )
  })
})

describe('warnings for optional settings', () => {
  it('says bank sync is off, and what still works, without Plaid keys', () => {
    expect(configWarnings(required)).toEqual([
      expect.stringMatching(
        /^Bank sync is off: set PLAID_CLIENT_ID and PLAID_SECRET.*imported from a CSV file\.$/,
      ),
    ])
  })

  it('names the missing half of the Plaid keys', () => {
    expect(configWarnings({ ...required, PLAID_CLIENT_ID: 'id' })).toEqual([
      'Bank sync is off: PLAID_CLIENT_ID is set but PLAID_SECRET is not. Set both.',
    ])
    expect(configWarnings({ ...required, PLAID_SECRET: 'secret', PLAID_CLIENT_ID: ' ' })).toEqual([
      'Bank sync is off: PLAID_SECRET is set but PLAID_CLIENT_ID is not. Set both.',
    ])
  })

  it('warns about bank updates only when banks are on and no public address is known', () => {
    const plaid = { ...required, PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' }
    expect(configWarnings(plaid)).toEqual([expect.stringMatching(/^PUBLIC_URL is not set/)])
    expect(configWarnings({ ...plaid, PUBLIC_URL: 'https://money.example.com' })).toEqual([])
    expect(configWarnings({ ...plaid, RAILWAY_PUBLIC_DOMAIN: 'leeway.up.railway.app' })).toEqual([])
  })

  it('reads the real environment by default', () => {
    expect(Array.isArray(configWarnings())).toBe(true)
  })
})

describe('waiting for the database', () => {
  /** A database that refuses the first `failures` questions. */
  function startingDatabase(failures: number) {
    let asked = 0
    return {
      get asked() {
        return asked
      },
      async query() {
        asked += 1
        if (asked <= failures) throw new Error('connect ECONNREFUSED')
        return { rows: [] }
      },
    }
  }

  it('returns as soon as the database answers', async () => {
    const db = startingDatabase(0)
    await waitForDatabase(db, { delayMs: 0 })
    expect(db.asked).toBe(1)
  })

  it('keeps asking while the database starts', async () => {
    const db = startingDatabase(3)
    await waitForDatabase(db, { attempts: 5, delayMs: 1 })
    expect(db.asked).toBe(4)
  })

  it('gives up with a plain message', async () => {
    const db = startingDatabase(10)
    await expect(waitForDatabase(db, { attempts: 3, delayMs: 1 })).rejects.toThrow(
      'Could not reach the database after 3 tries (connect ECONNREFUSED). Check DATABASE_URL and that the database is running.',
    )
    expect(db.asked).toBe(3)
  })

  it('waits for a real database with the defaults', async () => {
    await expect(waitForDatabase({ query: async () => ({}) })).resolves.toBeUndefined()
  })
})
