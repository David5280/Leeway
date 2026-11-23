// Reads Playwright's JSON reports: which tests a run should have run (from
// `playwright test --list`) and what happened to them (the shards' merged
// report), and decides whether the run passed. Pure, and unit-tested.

import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter'

/** What happened to one test, in Playwright's own words. */
export type Outcome = 'expected' | 'unexpected' | 'flaky' | 'skipped'

export interface TestRecord {
  /** Project, file and title path, like "[desktop] budgets.spec.ts › Budgets › adds one". */
  id: string
  outcome: Outcome
}

export interface ShardResult {
  index: number
  /** The shard's Playwright exit code: 0 when every one of its tests passed. */
  exitCode: number
}

export interface Summary {
  passed: number
  failed: number
  flaky: number
  skipped: number
  /** Ids of the failed tests. */
  failures: string[]
  /** Ids of tests the run should have run but no shard reported. */
  missing: string[]
  /** Shards whose Playwright exited with an error. */
  failedShards: number[]
  /** Errors outside any test, like a server that would not start. */
  errors: string[]
}

/** Every test in a report, one record per project it ran in, walking nested describes. */
export function collectTests(report: JSONReport): TestRecord[] {
  const records: TestRecord[] = []
  const walk = (suite: JSONReportSuite, titles: string[]): void => {
    const path = [...titles, suite.title]
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        records.push({
          id: `[${test.projectName}] ${[...path, spec.title].join(' › ')}`,
          outcome: test.status,
        })
      }
    }
    for (const child of suite.suites ?? []) walk(child, path)
  }
  for (const suite of report.suites) walk(suite, [])
  return records
}

/**
 * One outcome for a test reported more than once. A project the others depend
 * on (setup) runs in every shard, so its tests are reported once per shard;
 * a failure in any shard is a failure.
 */
function combine(outcomes: Outcome[]): Outcome {
  if (outcomes.includes('unexpected')) return 'unexpected'
  if (outcomes.includes('flaky')) return 'flaky'
  if (outcomes.every((outcome) => outcome === 'skipped')) return 'skipped'
  return 'expected'
}

/** What the run did against what it should have done. */
export function summarize(
  expected: TestRecord[],
  report: JSONReport,
  shards: ShardResult[],
): Summary {
  const outcomes = new Map<string, Outcome[]>()
  for (const { id, outcome } of collectTests(report)) {
    outcomes.set(id, [...(outcomes.get(id) ?? []), outcome])
  }
  const combined = [...outcomes].map(([id, all]) => ({ id, outcome: combine(all) }))
  const count = (outcome: Outcome) => combined.filter((test) => test.outcome === outcome).length
  return {
    passed: count('expected'),
    failed: count('unexpected'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    failures: combined.filter((test) => test.outcome === 'unexpected').map((test) => test.id),
    missing: [...new Set(expected.map((test) => test.id))].filter((id) => !outcomes.has(id)),
    failedShards: shards.filter((shard) => shard.exitCode !== 0).map((shard) => shard.index),
    errors: report.errors.map((error) => error.message ?? String(error.value)),
  }
}

/**
 * The run passes only when every test that should have run did and passed,
 * every shard exited cleanly, and nothing failed outside a test. A flaky test
 * (passed on a retry, in CI) passes, as it does in a plain Playwright run.
 */
export function passed(summary: Summary): boolean {
  return (
    summary.failed === 0 &&
    summary.missing.length === 0 &&
    summary.failedShards.length === 0 &&
    summary.errors.length === 0
  )
}

/** The summary as the lines printed at the end of a run. */
export function formatSummary(summary: Summary, seconds: number): string[] {
  const lines = [
    `${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky, ` +
      `${summary.skipped} skipped in ${Math.round(seconds)}s`,
  ]
  const section = (title: string, items: string[]) => {
    if (items.length > 0) lines.push(`${title}:`, ...items.map((item) => `  ${item}`))
  }
  section('Failed', summary.failures)
  section('Never reported (a shard stopped early?)', summary.missing)
  section(
    'Shards that exited with an error',
    summary.failedShards.map((index) => `shard ${index}`),
  )
  section('Errors outside any test', summary.errors)
  lines.push(passed(summary) ? 'Sharded run passed.' : 'Sharded run FAILED.')
  return lines
}
