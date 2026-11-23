import { mkdtemp, readFile, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isPortFree, runToLog, stopAll } from './processes.ts'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'leeway-processes-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Runs a line of JavaScript in a new Node process, as runToLog would run Playwright. */
const node = (code: string, env: Record<string, string> = {}, logFile = path.join(dir, 'log')) =>
  runToLog(process.execPath, ['-e', code], { env, logFile })

describe('runToLog', () => {
  it('writes the output and errors to the log, making its folder, and gives the exit code', async () => {
    const logFile = path.join(dir, 'nested', 'out.log')
    const code = await node(
      'process.stdout.write(`out ${process.env.GREETING}\\n`); process.stderr.write("err\\n"); process.exit(3)',
      { GREETING: 'hello' },
      logFile,
    )
    expect(code).toBe(3)
    const log = await readFile(logFile, 'utf8')
    expect(log).toContain('out hello\n')
    expect(log).toContain('err\n')
  })

  it('gives 0 for a command that succeeds', async () => {
    expect(await node('')).toBe(0)
  })

  it('counts a command that cannot start as failed, and says why in the log', async () => {
    const logFile = path.join(dir, 'missing.log')
    const code = await runToLog(path.join(dir, 'no-such-command'), [], { env: {}, logFile })
    expect(code).toBe(1)
    expect(await readFile(logFile, 'utf8')).toMatch(/^Could not start .*no-such-command: /)
  })

  it('stops running commands as Ctrl+C would, counting them as failed', async () => {
    // The child says when it is ready, so the stop cannot come before it listens for it.
    const logFile = path.join(dir, 'stopped.log')
    const run = node('process.stdout.write("ready\\n"); setInterval(() => {}, 1000)', {}, logFile)
    await expect
      .poll(async () => readFile(logFile, 'utf8').catch(() => ''), { timeout: 5000 })
      .toContain('ready')
    stopAll()
    expect(await run).toBe(1)
  })
})

describe('isPortFree', () => {
  it('tells a free port from one something listens on', async () => {
    const server = net.createServer()
    await new Promise<void>((done) => server.listen(0, done))
    const { port } = server.address() as net.AddressInfo
    expect(await isPortFree(port)).toBe(false)
    await new Promise((done) => server.close(done))
    expect(await isPortFree(port)).toBe(true)
  })
})
