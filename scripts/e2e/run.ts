// The sharded run from start to end: list the tests, give each shard a
// database and a port, run the shards side by side, merge their reports and
// decide. Everything that touches the system comes in through `RunDeps`, so
// the order of steps, the clean-up and the exit code are unit-tested.

import type { JSONReport } from '@playwright/test/reporter'
import { UsageError, type RunOptions } from './options.ts'
import { planShards, shardCount, type Shard } from './plan.ts'
import { collectTests, formatSummary, passed, summarize, type ShardResult } from './report.ts'

export interface RunDeps {
  /** Empties the folder a run writes to, so no blob from an earlier run is merged. */
  resetRunDir(): Promise<void>
  listTests(files: string[]): Promise<JSONReport>
  isPortFree(port: number): Promise<boolean>
  createDatabase(databaseUrl: string, name: string): Promise<void>
  dropDatabase(databaseUrl: string, name: string): Promise<void>
  runShard(shard: Shard, files: string[]): Promise<number>
  mergeReports(): Promise<JSONReport>
  log(line: string): void
  /** Milliseconds, for the timings printed. */
  now(): number
}

/** Fails before anything starts when a shard's port is taken, naming the port. */
async function assertPortsFree(shards: Shard[], deps: RunDeps): Promise<void> {
  const free = await Promise.all(shards.map((shard) => deps.isPortFree(shard.port)))
  const taken = shards.filter((_, index) => !free[index]).map((shard) => shard.port)
  if (taken.length > 0) {
    throw new UsageError(
      `Port ${taken.join(', ')} is in use. Set E2E_PORT_BASE to the first of ${shards.length} free ports.`,
    )
  }
}

/** Runs every shard at once and reports each one's end as it comes. */
function runShards(shards: Shard[], files: string[], deps: RunDeps): Promise<ShardResult[]> {
  return Promise.all(
    shards.map(async (shard) => {
      const started = deps.now()
      const exitCode = await deps.runShard(shard, files)
      const seconds = Math.round((deps.now() - started) / 1000)
      const result = exitCode === 0 ? 'passed' : `FAILED (exit ${exitCode})`
      deps.log(
        `Shard ${shard.index}/${shard.total} ${result} in ${seconds}s; log: ${shard.logFile}`,
      )
      return { index: shard.index, exitCode }
    }),
  )
}

/** Runs the chosen tests across shards and gives the exit code: 0 only when the run passed. */
export async function runSharded(options: RunOptions, deps: RunDeps): Promise<number> {
  const started = deps.now()
  await deps.resetRunDir()
  const expected = collectTests(await deps.listTests(options.files))
  if (expected.length === 0) throw new UsageError('No tests match those files.')

  const shards = planShards(
    shardCount(options.maxShards, expected.length),
    options.portBase,
    options.databaseUrl,
  )
  await assertPortsFree(shards, deps)
  deps.log(
    `Running ${expected.length} tests in ${shards.length} shard(s), ` +
      `on ports ${shards.map((shard) => shard.port).join(', ')}...`,
  )

  let results: ShardResult[]
  try {
    await Promise.all(
      shards.map((shard) => deps.createDatabase(options.databaseUrl, shard.databaseName)),
    )
    results = await runShards(shards, options.files, deps)
  } finally {
    // Dropped even when a shard fails or the run is stopped, unless asked to keep them.
    if (!options.keepDatabases) {
      await Promise.all(
        shards.map((shard) => deps.dropDatabase(options.databaseUrl, shard.databaseName)),
      )
    }
  }

  const summary = summarize(expected, await deps.mergeReports(), results)
  for (const line of formatSummary(summary, (deps.now() - started) / 1000)) deps.log(line)
  return passed(summary) ? 0 : 1
}
