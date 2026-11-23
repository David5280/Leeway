// Child processes and ports: the runner's only contact with the operating
// system besides the database (databases.ts) and the file system (cli.ts).

import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

/** Children still running, so a stop request can reach them (see stopAll). */
const running = new Set<ChildProcess>()

export interface CommandOptions {
  /** Added to this process's own environment. */
  env: Record<string, string>
  /** Where the command's output and errors go. */
  logFile: string
}

/**
 * Runs a command to the end with its output in a log file, and gives its exit
 * code. A command stopped by a signal counts as failed (1), as does one that
 * cannot start at all.
 */
export async function runToLog(
  command: string,
  args: string[],
  options: CommandOptions,
): Promise<number> {
  await mkdir(path.dirname(options.logFile), { recursive: true })
  const log = createWriteStream(options.logFile)
  try {
    return await new Promise<number>((resolve) => {
      const child = spawn(command, args, {
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      running.add(child)
      child.stdout.pipe(log, { end: false })
      child.stderr.pipe(log, { end: false })
      // A command that cannot start may never close, so this settles it too.
      child.on('error', (error) => {
        running.delete(child)
        log.write(`Could not start ${command}: ${error.message}\n`)
        resolve(1)
      })
      // 'close' comes after the output streams have ended, so the log is whole.
      child.on('close', (code) => {
        running.delete(child)
        resolve(code ?? 1)
      })
    })
  } finally {
    await new Promise((done) => log.end(done))
  }
}

/**
 * Asks every running child to stop as on Ctrl+C. Playwright then stops the
 * test server it started, so no server is left holding a port or database.
 */
export function stopAll(): void {
  for (const child of running) child.kill('SIGINT')
}

/** Whether nothing is listening on this port yet. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port)
  })
}
