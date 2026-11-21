import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { UsageError } from './options.ts'
import {
  baseDatabaseName,
  MIN_TESTS_PER_SHARD,
  planShards,
  RUN_DIR,
  shardCount,
  shardEnv,
  withDatabase,
} from './plan.ts'

const BASE_URL = 'postgres://postgres@localhost:5432/leeway_e2e_shards'

describe('shardCount', () => {
  it('gives each shard at least the minimum number of tests', () => {
    expect(shardCount(4, 1)).toBe(1)
    expect(shardCount(4, MIN_TESTS_PER_SHARD)).toBe(1)
    expect(shardCount(4, MIN_TESTS_PER_SHARD + 1)).toBe(2)
    expect(shardCount(4, MIN_TESTS_PER_SHARD * 3)).toBe(3)
  })

  it('never runs more shards than allowed', () => {
    expect(shardCount(4, 740)).toBe(4)
    expect(shardCount(1, 740)).toBe(1)
  })

  it('runs one shard even for no tests', () => {
    expect(shardCount(4, 0)).toBe(1)
  })
})

describe('baseDatabaseName', () => {
  it('reads the database name from the URL', () => {
    expect(baseDatabaseName(BASE_URL)).toBe('leeway_e2e_shards')
  })

  it('refuses a URL that does not parse', () => {
    expect(() => baseDatabaseName('not a url')).toThrow(UsageError)
    expect(() => baseDatabaseName('not a url')).toThrow('E2E_DATABASE_URL is not a URL')
  })

  it.each(['leeway_test', 'Leeway_e2e', 'leeway-e2e', 'leeway_e2e;drop', ''])(
    'refuses the database name "%s", which the test server would refuse or Postgres would fold',
    (name) => {
      expect(() => baseDatabaseName(`postgres://localhost/${name}`)).toThrow(UsageError)
    },
  )

  it('refuses a name too long to take a shard suffix within Postgres limits', () => {
    expect(() => baseDatabaseName(`postgres://localhost/e2e${'x'.repeat(60)}`)).toThrow(UsageError)
  })
})

describe('withDatabase', () => {
  it('keeps the server, user and options and changes only the database', () => {
    expect(withDatabase('postgres://me:pw@db:6543/leeway_e2e?sslmode=disable', 'postgres')).toBe(
      'postgres://me:pw@db:6543/postgres?sslmode=disable',
    )
  })
})

describe('planShards', () => {
  it('gives every shard its own port, database, session and result files', () => {
    const shards = planShards(3, 3400, BASE_URL)
    expect(shards[1]).toEqual({
      index: 2,
      total: 3,
      port: 3401,
      databaseName: 'leeway_e2e_shards_shard2',
      databaseUrl: 'postgres://postgres@localhost:5432/leeway_e2e_shards_shard2',
      authFile: path.join('e2e', '.auth', 'shard-2.json'),
      outputDir: path.join(RUN_DIR, 'shard-2'),
      blobFile: path.join(RUN_DIR, 'blobs', 'shard-2.zip'),
      logFile: path.join(RUN_DIR, 'shard-2.log'),
    })
    // Nothing one shard owns is shared with another.
    for (const key of ['port', 'databaseName', 'authFile', 'outputDir', 'blobFile'] as const) {
      expect(new Set(shards.map((shard) => shard[key])).size).toBe(3)
    }
  })

  it('numbers shards from 1, as Playwright does', () => {
    expect(planShards(2, 3110, BASE_URL).map((shard) => `${shard.index}/${shard.total}`)).toEqual([
      '1/2',
      '2/2',
    ])
  })

  it('checks the base database before planning anything', () => {
    expect(() => planShards(2, 3110, 'postgres://localhost/leeway')).toThrow(UsageError)
  })
})

describe('shardEnv', () => {
  it('hands the shard its server, database, session and result paths', () => {
    const [shard] = planShards(1, 3400, BASE_URL)
    expect(shardEnv(shard!)).toEqual({
      E2E_PORT: '3400',
      E2E_DATABASE_URL: 'postgres://postgres@localhost:5432/leeway_e2e_shards_shard1',
      E2E_AUTH_FILE: shard!.authFile,
      E2E_OUTPUT_DIR: shard!.outputDir,
      PLAYWRIGHT_BLOB_OUTPUT_FILE: shard!.blobFile,
    })
  })
})
