// What the runner asks of Playwright's command line. Playwright itself is
// stood in for: runToLog records each command and writes the JSON report a
// real run would write.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { planShards, RUN_DIR } from './plan.ts'
import { listTests, mergeReports, runShard } from './playwright.ts'
import { runToLog, type CommandOptions } from './processes.ts'

vi.mock('./processes.ts', () => ({ runToLog: vi.fn() }))

/** The exit code the stand-in Playwright gives next. */
let exitCode = 0

/** Answers like Playwright: writes a report where asked, and exits with `exitCode`. */
async function fakePlaywright(_command: string, _args: string[], options: CommandOptions) {
  const jsonFile = options.env.PLAYWRIGHT_JSON_OUTPUT_NAME
  if (jsonFile)
    await writeFile(jsonFile, JSON.stringify({ suites: [], errors: [], from: jsonFile }))
  return exitCode
}

const home = process.cwd()
let dir: string
beforeAll(async () => {
  // RUN_DIR is relative, as the runner works from the repository's root.
  dir = await mkdtemp(path.join(os.tmpdir(), 'leeway-playwright-'))
  process.chdir(dir)
  await mkdir(RUN_DIR, { recursive: true })
})
afterAll(async () => {
  process.chdir(home)
  await rm(dir, { recursive: true, force: true })
})
beforeEach(() => {
  exitCode = 0
  vi.mocked(runToLog).mockReset().mockImplementation(fakePlaywright)
})

/** The Playwright arguments and options of the only command run, without Node and the CLI path. */
function onlyCommand() {
  expect(runToLog).toHaveBeenCalledTimes(1)
  const [command, [cli, ...args], options] = vi.mocked(runToLog).mock.calls[0]!
  expect(command).toBe(process.execPath)
  expect(cli).toMatch(/@playwright[\\/]test[\\/]cli\.js$/)
  return { args, options }
}

describe('listTests', () => {
  it('lists the chosen files as JSON, running nothing, and reads the list back', async () => {
    const report = await listTests(['e2e/a.spec.ts'])
    const { args, options } = onlyCommand()
    expect(args).toEqual(['test', '--list', '--reporter=json', 'e2e/a.spec.ts'])
    expect(options).toEqual({
      env: { PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(RUN_DIR, 'list.json') },
      logFile: path.join(RUN_DIR, 'list.log'),
    })
    expect(report).toMatchObject({ from: path.join(RUN_DIR, 'list.json') })
  })

  it('fails, pointing at the log, when Playwright cannot list the tests', async () => {
    exitCode = 1
    await expect(listTests([])).rejects.toThrow(
      `playwright test failed; see ${path.join(RUN_DIR, 'list.log')}`,
    )
  })
})

describe('runShard', () => {
  it('runs one shard of the chosen files to a blob, with its own environment and log', async () => {
    const [, shard] = planShards(2, 3400, 'postgres://localhost/leeway_e2e')
    exitCode = 1
    expect(await runShard(shard!, ['e2e/a.spec.ts'])).toBe(1)
    const { args, options } = onlyCommand()
    expect(args).toEqual([
      'test',
      '--shard=2/2',
      '--reporter=blob,list',
      '--pass-with-no-tests',
      'e2e/a.spec.ts',
    ])
    expect(options.logFile).toBe(shard!.logFile)
    expect(options.env).toMatchObject({ E2E_PORT: '3401', E2E_AUTH_FILE: shard!.authFile })
  })
})

describe('mergeReports', () => {
  it('merges the blobs into a JSON report it reads back and an HTML report it does not open', async () => {
    const report = await mergeReports()
    const { args, options } = onlyCommand()
    expect(args).toEqual(['merge-reports', '--reporter=json,html', path.join(RUN_DIR, 'blobs')])
    expect(options.env).toEqual({
      PLAYWRIGHT_HTML_OPEN: 'never',
      PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(RUN_DIR, 'merge.json'),
    })
    expect(report).toMatchObject({ from: path.join(RUN_DIR, 'merge.json') })
  })
})
