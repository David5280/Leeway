// A fresh install starting up: clear messages for settings left out, and
// waiting for a database that is still starting.

import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, platformOf } from '../src/config.js'
import { waitForDatabase } from '../src/db/pool.js'
import { configWarnings, explainConfigError, whereToSet } from '../src/startupMessages.js'

const required = { DATABASE_URL: 'postgres://localhost/leeway', ENCRYPTION_KEY: 'ab'.repeat(32) }
const plaid = { ...required, PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' }
const railway = { RAILWAY_PROJECT_ID: 'project' }

/** The ConfigError loadConfig throws for these settings. */
function problemsWith(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env)
  } catch (error) {
    if (error instanceof ConfigError) return error
    throw error
  }
  throw new Error('These settings were accepted')
}

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

  it('lists every problem by its variable name', () => {
    expect(problemsWith({}).problems.map((p) => p.name)).toEqual(['DATABASE_URL', 'ENCRYPTION_KEY'])
  })

  it('says in plain words what each optional setting takes when it is malformed', () => {
    const messages = (env: NodeJS.ProcessEnv) =>
      problemsWith({ ...required, ...env }).problems.map((p) => `${p.name}: ${p.message}`)
    expect(messages({ PLAID_ENV: 'live' })).toEqual([
      'PLAID_ENV: set it to sandbox (Plaid test banks) or production (your real banks)',
    ])
    expect(messages({ PUBLIC_URL: 'leeway.example.com' })).toEqual([
      'PUBLIC_URL: set it to a full web address, like https://leeway.example.com, or leave it empty',
    ])
    expect(messages({ SETUP_CODE: 'short' })).toEqual([
      'SETUP_CODE: use 12 characters or more, or leave it empty and Leeway prints a code in its log',
    ])
    expect(messages({ SYNC_INTERVAL_MINUTES: 'hourly' })).toEqual([
      'SYNC_INTERVAL_MINUTES: set it to a number of minutes, like 360, or 0 to turn background sync off',
    ])
    expect(messages({ SYNC_INTERVAL_MINUTES: '1.5' })).toEqual([
      'SYNC_INTERVAL_MINUTES: set it to a whole number of minutes, like 360',
    ])
    expect(messages({ DATABASE_SSL: 'yes' })).toEqual([
      'DATABASE_SSL: set it to true or false, or leave it empty',
    ])
  })
})

describe('where Leeway runs', () => {
  it('knows Railway by the variables Railway sets, even inside the Docker image', () => {
    expect(platformOf({ ...railway, LEEWAY_DOCKER: 'true' })).toBe('railway')
    expect(platformOf({ RAILWAY_PUBLIC_DOMAIN: 'leeway.up.railway.app' })).toBe('railway')
  })

  it('knows Docker by the variable the image sets, and calls the rest other', () => {
    expect(platformOf({ LEEWAY_DOCKER: 'true' })).toBe('docker')
    expect(platformOf({ LEEWAY_DOCKER: ' ' })).toBe('other')
    expect(platformOf({})).toBe('other')
  })

  it('is part of the configuration', () => {
    expect(loadConfig({ ...required, LEEWAY_DOCKER: 'true' }).platform).toBe('docker')
  })

  it('reads the real environment by default', () => {
    expect(['railway', 'docker', 'other']).toContain(platformOf())
  })

  it('says where to change a setting on each platform', () => {
    expect(whereToSet('railway')).toBe(
      "in your Leeway service's Variables on Railway, then deploy the change",
    )
    expect(whereToSet('docker')).toBe('in your .env file, then run: docker compose up -d')
    expect(whereToSet('other')).toMatch(/then restart Leeway$/)
  })
})

describe('explaining settings that stop the start', () => {
  it('lists each problem, then says where to fix them', () => {
    expect(explainConfigError(problemsWith(railway), railway)).toBe(
      [
        "Leeway can't start until these settings are fixed:",
        '  DATABASE_URL: set it to a Postgres connection string (on Railway, ${{Postgres.DATABASE_URL}})',
        '  ENCRYPTION_KEY: set it to 64 hex characters (generate one with: openssl rand -hex 32), and keep a copy somewhere safe',
        "Set them in your Leeway service's Variables on Railway, then deploy the change.",
      ].join('\n'),
    )
  })

  it('says "it" for a single problem', () => {
    const env = { ...required, LEEWAY_DOCKER: 'true', PLAID_ENV: 'live' }
    expect(explainConfigError(problemsWith(env), env)).toMatch(
      /\nSet it in your \.env file, then run: docker compose up -d\.$/,
    )
  })
})

describe('warnings for optional settings', () => {
  it('says bank sync is off, that this is fine, and how to turn it on', () => {
    expect(configWarnings({ ...required, ...railway })).toEqual([
      "Bank sync is off, which is fine: accounts and transactions can be added by hand or imported from a CSV file. To turn it on, set PLAID_CLIENT_ID and PLAID_SECRET from dashboard.plaid.com/developers/keys in your Leeway service's Variables on Railway, then deploy the change.",
    ])
  })

  it('names the missing half of the Plaid keys', () => {
    expect(configWarnings({ ...required, PLAID_CLIENT_ID: 'id', LEEWAY_DOCKER: 'true' })).toEqual([
      'Bank sync is off: PLAID_CLIENT_ID is set but PLAID_SECRET is not. Set both in your .env file, then run: docker compose up -d.',
    ])
    expect(configWarnings({ ...required, PLAID_SECRET: 'secret', PLAID_CLIENT_ID: ' ' })).toEqual([
      expect.stringMatching(/^Bank sync is off: PLAID_SECRET is set but PLAID_CLIENT_ID is not/),
    ])
  })

  it('says Sandbox has only test banks, and how to switch to real ones', () => {
    const live = { ...plaid, PUBLIC_URL: 'https://money.example.com' }
    expect(configWarnings(live)).toEqual([
      expect.stringMatching(
        /^Bank sync uses Plaid's Sandbox, which has only test banks\..*set PLAID_ENV to production and PLAID_SECRET to your Production secret/,
      ),
    ])
    expect(configWarnings({ ...live, PLAID_ENV: 'production' })).toEqual([])
  })

  it('warns about bank updates only when banks are on and no public address is known', () => {
    const production = { ...plaid, PLAID_ENV: 'production' }
    expect(configWarnings(production)).toEqual([expect.stringMatching(/^PUBLIC_URL is not set/)])
    expect(configWarnings({ ...production, PUBLIC_URL: 'https://money.example.com' })).toEqual([])
    expect(
      configWarnings({ ...production, RAILWAY_PUBLIC_DOMAIN: 'leeway.up.railway.app' }),
    ).toEqual([])
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
