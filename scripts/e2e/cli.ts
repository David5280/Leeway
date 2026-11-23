// Runs the browser tests as parallel Playwright shards, each with its own
// server, port, database and signed-in session (see CONTRIBUTING.md).
//
//   npm run e2e:full                          every spec
//   npm run e2e:some -- e2e/budgets.spec.ts   only these specs
//
// Needs a build (npm run build) and Node 22.18 or newer, which runs this
// TypeScript directly.

import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import { createDatabase, dropDatabase } from './databases.ts'
import { readOptions, UsageError } from './options.ts'
import { RUN_DIR } from './plan.ts'
import { listTests, mergeReports, runShard } from './playwright.ts'
import { isPortFree, stopAll } from './processes.ts'
import { runSharded } from './run.ts'

const log = (line: string) => process.stdout.write(`${line}\n`)

// Ctrl+C reaches the shards too, and each stops its own server; this process
// stays up meanwhile to drop the databases. A plain kill is passed on to them.
process.on('SIGINT', () => log('Stopping the shards...'))
process.on('SIGTERM', stopAll)

try {
  const options = readOptions(process.env, process.argv.slice(2), os.availableParallelism())
  process.exitCode = await runSharded(options, {
    resetRunDir: async () => {
      await rm(RUN_DIR, { recursive: true, force: true })
      await mkdir(RUN_DIR, { recursive: true })
    },
    listTests,
    isPortFree,
    createDatabase,
    dropDatabase,
    runShard,
    mergeReports,
    log,
    now: () => Date.now(),
  })
} catch (error) {
  // A usage mistake reads as a sentence; anything else keeps its stack.
  log(error instanceof UsageError ? error.message : String((error as Error).stack ?? error))
  process.exitCode = error instanceof UsageError ? 2 : 1
}
