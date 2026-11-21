// What a sharded browser test run is asked to do, read from the environment
// and the command line. Pure: no I/O, so every rule here is unit-tested.

/** The most shards a run starts by default: each one is a server, a database and a browser. */
export const DEFAULT_MAX_SHARDS = 4

/** The first port a run's shards listen on when E2E_PORT_BASE is not set. */
export const DEFAULT_PORT_BASE = 3110

/** The database the shards' own databases are named after when E2E_DATABASE_URL is not set. */
export const DEFAULT_DATABASE_URL = 'postgres://postgres@localhost:5432/leeway_e2e'

export interface RunOptions {
  /** How many shards to run at most; fewer when the chosen tests are too few to share out. */
  maxShards: number
  /** Shard 1 listens here, shard 2 one port up, and so on. */
  portBase: number
  /** The server and base name for the shards' databases (see plan.ts). */
  databaseUrl: string
  /** Leave the shards' databases behind after the run, to look into a failure. */
  keepDatabases: boolean
  /** Spec files to run, as given on the command line; empty for the whole suite. */
  files: string[]
}

/** A mistake in how the run was asked for, reported as a sentence rather than a stack. */
export class UsageError extends Error {
  override name = 'UsageError'
}

/** A whole number from the environment within [min, max], or the fallback when unset. */
function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  [min, max]: [number, number],
): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`${name} must be a whole number from ${min} to ${max}, not "${raw}".`)
  }
  return value
}

/**
 * The run's options. `args` are the command line after the script: the mode
 * ("full" for the whole suite, "some" for the spec files that follow), then
 * the files. `cores` is the machine's available parallelism: by default the
 * run uses one shard per core, up to DEFAULT_MAX_SHARDS, since every shard
 * keeps a server and a browser busy.
 */
export function readOptions(env: NodeJS.ProcessEnv, args: string[], cores: number): RunOptions {
  const [mode, ...files] = args
  if (mode !== 'full' && mode !== 'some') {
    throw new UsageError(`Run as "full" or "some <spec files>", not "${mode ?? ''}".`)
  }
  if (mode === 'full' && files.length > 0) {
    throw new UsageError('npm run e2e:full runs every spec. Name spec files with npm run e2e:some.')
  }
  if (mode === 'some' && files.length === 0) {
    throw new UsageError(
      'Name the spec files to run, like: npm run e2e:some -- e2e/budgets.spec.ts',
    )
  }
  const flag = files.find((file) => file.startsWith('-'))
  if (flag !== undefined) {
    // Playwright flags would apply to every shard in ways this runner cannot
    // check (--shard, --workers, --reporter), so only spec files are taken.
    throw new UsageError(
      `Only spec files are taken, not "${flag}". Use npx playwright test for other options.`,
    )
  }
  const defaultShards = Math.max(1, Math.min(DEFAULT_MAX_SHARDS, cores))
  const maxShards = readInteger(env, 'E2E_SHARDS', defaultShards, [1, 32])
  // Every shard's port must fit below 65536.
  const portBase = readInteger(env, 'E2E_PORT_BASE', DEFAULT_PORT_BASE, [1024, 65_535 - maxShards])
  return {
    maxShards,
    portBase,
    databaseUrl: env.E2E_DATABASE_URL || DEFAULT_DATABASE_URL,
    keepDatabases: env.E2E_KEEP_DATABASES === '1',
    files,
  }
}
