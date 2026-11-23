import type { JSONReport } from '@playwright/test/reporter'
import { describe, expect, it, vi } from 'vitest'
import { UsageError, type RunOptions } from './options.ts'
import type { Shard } from './plan.ts'
import { runSharded, type RunDeps } from './run.ts'

/** A report of `count` desktop tests in one file, each with this outcome. */
function reportOf(count: number, status = 'expected'): JSONReport {
  const specs = Array.from({ length: count }, (_, index) => ({
    title: `test ${index}`,
    tests: [{ projectName: 'desktop', status }],
  }))
  return { suites: [{ title: 'a.spec.ts', specs }], errors: [] } as unknown as JSONReport
}

const OPTIONS: RunOptions = {
  maxShards: 4,
  portBase: 3400,
  databaseUrl: 'postgres://postgres@localhost:5432/leeway_e2e_shards',
  keepDatabases: false,
  files: [],
}

/**
 * Stand-ins for everything the run touches. Each records its calls in
 * `steps`, in order, so a test can check what happened when.
 */
function fakeDeps(tests = 100, overrides: Partial<RunDeps> = {}) {
  const steps: string[] = []
  const lines: string[] = []
  let clock = 0
  /** Notes a step and answers with `value`. */
  const step = <T>(name: string, value: T): T => {
    steps.push(name)
    return value
  }
  const deps: RunDeps = {
    resetRunDir: vi.fn(async () => step('reset', undefined)),
    listTests: vi.fn(async () => step('list', reportOf(tests))),
    isPortFree: vi.fn(async () => true),
    createDatabase: vi.fn(async (_url: string, name: string) => step(`create ${name}`, undefined)),
    dropDatabase: vi.fn(async (_url: string, name: string) => step(`drop ${name}`, undefined)),
    runShard: vi.fn(async (shard: Shard) => step(`run ${shard.index}`, 0)),
    mergeReports: vi.fn(async () => step('merge', reportOf(tests))),
    log: (line) => lines.push(line),
    // Each reading of the clock is ten seconds after the last, so four
    // shards started together, then finished together, each take 40s.
    now: () => (clock += 10_000),
    ...overrides,
  }
  return { deps, steps, lines }
}

describe('runSharded', () => {
  it('runs every shard on its own database, cleans up, and passes', async () => {
    const { deps, steps, lines } = fakeDeps(100)
    expect(await runSharded(OPTIONS, deps)).toBe(0)

    const names = [1, 2, 3, 4].map((index) => `leeway_e2e_shards_shard${index}`)
    expect(steps).toEqual([
      'reset',
      'list',
      ...names.map((name) => `create ${name}`),
      'run 1',
      'run 2',
      'run 3',
      'run 4',
      ...names.map((name) => `drop ${name}`),
      'merge',
    ])
    expect(deps.isPortFree).toHaveBeenCalledTimes(4)
    expect(lines[0]).toBe('Running 100 tests in 4 shard(s), on ports 3400, 3401, 3402, 3403...')
    expect(lines).toContain('Shard 2/4 passed in 40s; log: test-results/shards/shard-2.log')
    expect(lines.at(-1)).toBe('Sharded run passed.')
  })

  it('hands every shard the chosen files', async () => {
    const { deps } = fakeDeps(100)
    await runSharded({ ...OPTIONS, files: ['e2e/a.spec.ts'] }, deps)
    expect(deps.listTests).toHaveBeenCalledWith(['e2e/a.spec.ts'])
    expect(vi.mocked(deps.runShard).mock.calls.map(([, files]) => files)).toEqual(
      Array(4).fill(['e2e/a.spec.ts']),
    )
  })

  it('starts fewer shards for fewer tests', async () => {
    const { deps } = fakeDeps(5)
    expect(await runSharded(OPTIONS, deps)).toBe(0)
    expect(deps.runShard).toHaveBeenCalledTimes(1)
  })

  it('fails when a shard fails, and still drops every database', async () => {
    const { deps, steps, lines } = fakeDeps(100, {
      runShard: async (shard) => (shard.index === 3 ? 1 : 0),
    })
    expect(await runSharded(OPTIONS, deps)).toBe(1)
    expect(steps.filter((step) => step.startsWith('drop'))).toHaveLength(4)
    expect(lines).toContain(
      'Shard 3/4 FAILED (exit 1) in 40s; log: test-results/shards/shard-3.log',
    )
    expect(lines.at(-1)).toBe('Sharded run FAILED.')
  })

  it('fails when a test failed or never ran', async () => {
    const failing = fakeDeps(100, { mergeReports: async () => reportOf(100, 'unexpected') })
    expect(await runSharded(OPTIONS, failing.deps)).toBe(1)
    const short = fakeDeps(100, { mergeReports: async () => reportOf(99) })
    expect(await runSharded(OPTIONS, short.deps)).toBe(1)
    expect(short.lines).toContain('  [desktop] a.spec.ts › test 99')
  })

  it('drops the databases when a shard cannot be run at all', async () => {
    const { deps, steps } = fakeDeps(100, {
      runShard: async () => {
        throw new Error('spawn failed')
      },
    })
    await expect(runSharded(OPTIONS, deps)).rejects.toThrow('spawn failed')
    expect(steps.filter((step) => step.startsWith('drop'))).toHaveLength(4)
    expect(deps.mergeReports).not.toHaveBeenCalled()
  })

  it('keeps the databases when asked to', async () => {
    const { deps } = fakeDeps(100)
    expect(await runSharded({ ...OPTIONS, keepDatabases: true }, deps)).toBe(0)
    expect(deps.dropDatabase).not.toHaveBeenCalled()
  })

  it('stops before creating anything when a shard port is taken, naming the port', async () => {
    const { deps } = fakeDeps(100, { isPortFree: async (port) => port !== 3402 })
    const run = runSharded(OPTIONS, deps)
    await expect(run).rejects.toThrow(UsageError)
    await expect(run).rejects.toThrow('Port 3402 is in use. Set E2E_PORT_BASE')
    expect(deps.createDatabase).not.toHaveBeenCalled()
  })

  it('refuses files that match no tests', async () => {
    const { deps } = fakeDeps(0)
    await expect(runSharded(OPTIONS, deps)).rejects.toThrow('No tests match those files.')
    expect(deps.createDatabase).not.toHaveBeenCalled()
  })
})
