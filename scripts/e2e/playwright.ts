// Playwright's command line, as the runner uses it: list the tests, run one
// shard, and merge the shards' reports into one.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { JSONReport } from '@playwright/test/reporter'
import { RUN_DIR, shardEnv, type Shard } from './plan.ts'
import { runToLog } from './processes.ts'

/** Playwright's own command line script, run with this Node rather than through npx. */
const CLI = createRequire(import.meta.url).resolve('@playwright/test/cli')

/** Runs Playwright with a JSON report, and reads that report back. */
async function runForJson(args: string[], name: string, env: Record<string, string> = {}) {
  const jsonFile = path.join(RUN_DIR, `${name}.json`)
  const logFile = path.join(RUN_DIR, `${name}.log`)
  const code = await runToLog(process.execPath, [CLI, ...args], {
    env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile },
    logFile,
  })
  if (code !== 0) throw new Error(`playwright ${args[0]} failed; see ${logFile}`)
  return JSON.parse(await readFile(jsonFile, 'utf8')) as JSONReport
}

/** Every test the run should run, without running any (`playwright test --list`). */
export function listTests(files: string[]): Promise<JSONReport> {
  return runForJson(['test', '--list', '--reporter=json', ...files], 'list')
}

/**
 * Runs one shard and gives Playwright's exit code. Its report goes to a blob
 * for merging, and its progress to its log. A shard can be left with no tests
 * when the chosen files are fewer than the shards; that is not an error,
 * since the merged report is checked against the full list anyway.
 */
export function runShard(shard: Shard, files: string[]): Promise<number> {
  const args = [
    'test',
    `--shard=${shard.index}/${shard.total}`,
    '--reporter=blob,list',
    '--pass-with-no-tests',
    ...files,
  ]
  return runToLog(process.execPath, [CLI, ...args], {
    env: shardEnv(shard),
    logFile: shard.logFile,
  })
}

/** Merges the shards' blobs into one JSON report and one HTML report (playwright-report/). */
export function mergeReports(): Promise<JSONReport> {
  const blobs = path.join(RUN_DIR, 'blobs')
  return runForJson(['merge-reports', '--reporter=json,html', blobs], 'merge', {
    PLAYWRIGHT_HTML_OPEN: 'never',
  })
}
