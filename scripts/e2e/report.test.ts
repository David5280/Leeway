import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter'
import { describe, expect, it } from 'vitest'
import {
  collectTests,
  formatSummary,
  passed,
  summarize,
  type Outcome,
  type Summary,
} from './report.ts'

/** A test in a report: its project, title and outcome. */
type Entry = [project: string, title: string, outcome: Outcome]

/** A file's suite holding these tests, optionally inside describe blocks. */
function file(name: string, tests: Entry[], suites: JSONReportSuite[] = []): JSONReportSuite {
  return {
    title: name,
    file: name,
    line: 0,
    column: 0,
    specs: tests.map(([projectName, title, status]) => ({
      title,
      tests: [{ projectName, status }],
    })),
    suites,
  } as unknown as JSONReportSuite
}

/** A report with these files; only the parts the runner reads are filled in. */
function report(suites: JSONReportSuite[], errors: JSONReport['errors'] = []): JSONReport {
  return { suites, errors } as unknown as JSONReport
}

const SETUP: Entry = ['setup', 'creates the owner', 'expected']
const LISTED = report([
  file('setup.spec.ts', [SETUP]),
  file('budgets.spec.ts', [['desktop', 'adds a budget', 'expected']]),
  file('phone.spec.ts', [['phone', 'fits', 'expected']]),
])
const expected = collectTests(LISTED)
const cleanShards = [
  { index: 1, exitCode: 0 },
  { index: 2, exitCode: 0 },
]

describe('collectTests', () => {
  it('names each test by project, file and the describes around it', () => {
    const nested = file('guard.spec.ts', [], [file('on iPhone', [['phone', 'Home', 'flaky']])])
    expect(collectTests(report([nested]))).toEqual([
      { id: '[phone] guard.spec.ts › on iPhone › Home', outcome: 'flaky' },
    ])
  })

  it('gives a test run in two projects a record for each', () => {
    const both = report([
      file('a.spec.ts', [
        ['desktop', 'works', 'expected'],
        ['webkit', 'works', 'skipped'],
      ]),
    ])
    expect(collectTests(both).map((test) => test.id)).toEqual([
      '[desktop] a.spec.ts › works',
      '[webkit] a.spec.ts › works',
    ])
  })
})

describe('summarize', () => {
  it('counts setup, which runs in every shard, once', () => {
    const merged = report([
      file('setup.spec.ts', [SETUP, SETUP]),
      file('budgets.spec.ts', [['desktop', 'adds a budget', 'expected']]),
      file('phone.spec.ts', [['phone', 'fits', 'expected']]),
    ])
    const summary = summarize(expected, merged, cleanShards)
    expect(summary).toEqual({
      passed: 3,
      failed: 0,
      flaky: 0,
      skipped: 0,
      failures: [],
      missing: [],
      failedShards: [],
      errors: [],
    })
    expect(passed(summary)).toBe(true)
  })

  it('fails setup when it fails in any shard', () => {
    const merged = report([
      file('setup.spec.ts', [SETUP, ['setup', 'creates the owner', 'unexpected']]),
    ])
    const summary = summarize([], merged, cleanShards)
    expect(summary.failures).toEqual(['[setup] setup.spec.ts › creates the owner'])
    expect(passed(summary)).toBe(false)
  })

  it('counts flaky and skipped tests, which do not fail the run', () => {
    const merged = report([
      file('setup.spec.ts', [SETUP]),
      file('budgets.spec.ts', [['desktop', 'adds a budget', 'flaky']]),
      file('phone.spec.ts', [['phone', 'fits', 'skipped']]),
    ])
    const summary = summarize(expected, merged, cleanShards)
    expect(summary).toMatchObject({ passed: 1, flaky: 1, skipped: 1 })
    expect(passed(summary)).toBe(true)
  })

  it('names the tests no shard reported, and fails the run for them', () => {
    const merged = report([file('setup.spec.ts', [SETUP])])
    const summary = summarize(expected, merged, cleanShards)
    expect(summary.missing).toEqual([
      '[desktop] budgets.spec.ts › adds a budget',
      '[phone] phone.spec.ts › fits',
    ])
    expect(passed(summary)).toBe(false)
  })

  it('fails the run for a shard that exited with an error, even with every test passed', () => {
    const summary = summarize(expected, LISTED, [
      { index: 1, exitCode: 0 },
      { index: 2, exitCode: 1 },
    ])
    expect(summary.failedShards).toEqual([2])
    expect(passed(summary)).toBe(false)
  })

  it('fails the run for an error outside any test', () => {
    const errors = [{ message: 'Timed out waiting for the server' }, { value: 'thrown' }]
    const summary = summarize(expected, report(LISTED.suites, errors), cleanShards)
    expect(summary.errors).toEqual(['Timed out waiting for the server', 'thrown'])
    expect(passed(summary)).toBe(false)
  })
})

describe('formatSummary', () => {
  const clean: Summary = {
    passed: 738,
    failed: 0,
    flaky: 0,
    skipped: 2,
    failures: [],
    missing: [],
    failedShards: [],
    errors: [],
  }

  it('gives the totals and the time, and says the run passed', () => {
    expect(formatSummary(clean, 312.4)).toEqual([
      '738 passed, 0 failed, 0 flaky, 2 skipped in 312s',
      'Sharded run passed.',
    ])
  })

  it('lists each failure, missing test, failed shard and error under its own heading', () => {
    const summary: Summary = {
      ...clean,
      failed: 1,
      failures: ['[desktop] a.spec.ts › works'],
      missing: ['[phone] b.spec.ts › fits'],
      failedShards: [3],
      errors: ['Server would not start'],
    }
    expect(formatSummary(summary, 60)).toEqual([
      '738 passed, 1 failed, 0 flaky, 2 skipped in 60s',
      'Failed:',
      '  [desktop] a.spec.ts › works',
      'Never reported (a shard stopped early?):',
      '  [phone] b.spec.ts › fits',
      'Shards that exited with an error:',
      '  shard 3',
      'Errors outside any test:',
      '  Server would not start',
      'Sharded run FAILED.',
    ])
  })
})
