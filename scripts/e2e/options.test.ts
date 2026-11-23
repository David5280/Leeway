import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATABASE_URL,
  DEFAULT_MAX_SHARDS,
  DEFAULT_PORT_BASE,
  readOptions,
  UsageError,
} from './options.ts'

describe('readOptions', () => {
  it('runs the whole suite with one shard per core, up to the default most, by default', () => {
    expect(readOptions({}, ['full'], 16)).toEqual({
      maxShards: DEFAULT_MAX_SHARDS,
      portBase: DEFAULT_PORT_BASE,
      databaseUrl: DEFAULT_DATABASE_URL,
      keepDatabases: false,
      files: [],
    })
    expect(readOptions({}, ['full'], 2).maxShards).toBe(2)
  })

  it('still runs one shard on a machine that reports no cores', () => {
    expect(readOptions({}, ['full'], 0).maxShards).toBe(1)
  })

  it('takes the shard count, port base, database and keep flag from the environment', () => {
    const env = {
      E2E_SHARDS: '6',
      E2E_PORT_BASE: '3400',
      E2E_DATABASE_URL: 'postgres://db:5432/leeway_e2e_mine',
      E2E_KEEP_DATABASES: '1',
    }
    expect(readOptions(env, ['full'], 2)).toMatchObject({
      maxShards: 6,
      portBase: 3400,
      databaseUrl: 'postgres://db:5432/leeway_e2e_mine',
      keepDatabases: true,
    })
  })

  it('treats empty variables as unset', () => {
    const env = { E2E_SHARDS: '', E2E_PORT_BASE: '', E2E_DATABASE_URL: '' }
    expect(readOptions(env, ['full'], 3)).toMatchObject({
      maxShards: 3,
      portBase: DEFAULT_PORT_BASE,
      databaseUrl: DEFAULT_DATABASE_URL,
    })
  })

  it('runs only the spec files named after "some"', () => {
    const files = ['e2e/budgets.spec.ts', 'e2e/phone.spec.ts']
    expect(readOptions({}, ['some', ...files], 4).files).toEqual(files)
  })

  it.each([
    [[], 'Run as "full" or "some <spec files>", not "".'],
    [['all'], 'Run as "full" or "some <spec files>", not "all".'],
    [['full', 'e2e/a.spec.ts'], 'npm run e2e:full runs every spec.'],
    [['some'], 'Name the spec files to run'],
    [['some', '--workers=4'], 'Only spec files are taken, not "--workers=4".'],
  ])('refuses the command line %j', (args, message) => {
    expect(() => readOptions({}, args, 4)).toThrow(UsageError)
    expect(() => readOptions({}, args, 4)).toThrow(message)
  })

  it.each([
    ['E2E_SHARDS', '0', 'E2E_SHARDS must be a whole number from 1 to 32, not "0".'],
    ['E2E_SHARDS', '2.5', 'E2E_SHARDS must be a whole number from 1 to 32, not "2.5".'],
    ['E2E_SHARDS', 'four', 'E2E_SHARDS must be a whole number from 1 to 32, not "four".'],
    ['E2E_PORT_BASE', '80', 'E2E_PORT_BASE must be a whole number from 1024 to 65531'],
  ])('refuses %s=%s', (name, value, message) => {
    expect(() => readOptions({ [name]: value }, ['full'], 4)).toThrow(message)
  })

  it('keeps every shard port below 65536', () => {
    expect(() => readOptions({ E2E_PORT_BASE: '65532' }, ['full'], 4)).toThrow(UsageError)
    expect(readOptions({ E2E_PORT_BASE: '65531' }, ['full'], 4).portBase).toBe(65_531)
  })
})
