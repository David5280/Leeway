import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/context.js'
import { checkLogin, createOwner, createSession } from '../src/domain/owner.js'
import { createTestContext, resetData, TEST_DATABASE_URL, TEST_KEY_HEX } from './helpers.js'

let ctx: AppContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})

let printed: string[]
let errors: string[]

beforeEach(async () => {
  await resetData(ctx.db)
  printed = []
  errors = []
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  vi.stubEnv('ENCRYPTION_KEY', TEST_KEY_HEX)
  vi.spyOn(console, 'log').mockImplementation((line: string) => printed.push(line))
  vi.spyOn(console, 'error').mockImplementation((line: string) => errors.push(line))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  // The script sets the exit code on failure; keep it from failing the test run.
  process.exitCode = undefined
})

/** Runs the reset-password script as `npm run reset-password` would, in this process. */
async function runResetPassword(): Promise<void> {
  vi.resetModules()
  await import('../src/cli/reset-password.js')
}

describe('reset-password command', () => {
  it('prints a temporary password that works, and signs every device out', async () => {
    await createOwner(ctx.db, { email: 'me@example.com', password: 'correct horse battery' })
    await createSession(ctx.db)

    await runResetPassword()

    expect(process.exitCode).toBeUndefined()
    expect(printed[0]).toBe('Password for me@example.com reset. Every device is signed out.')
    const password = /\n\n {2}(\S+)\n$/.exec(printed[1] ?? '')?.[1]
    expect(password).toBeDefined()
    expect(await checkLogin(ctx.db, 'me@example.com', password ?? '')).toBe(true)
    const { rows } = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions')
    expect(rows[0]?.n).toBe(0)
  })

  it('explains that there is no account yet and exits with an error code', async () => {
    await runResetPassword()

    expect(errors).toEqual(['There is no account yet. Open Leeway to create one.'])
    expect(printed).toEqual([])
    expect(process.exitCode).toBe(1)
  })

  it('prints a failure that is not an Error object as it is', async () => {
    vi.doMock('../src/domain/owner.js', () => ({
      resetPassword: () => Promise.reject('database is read-only'),
    }))
    try {
      await runResetPassword()
    } finally {
      vi.doUnmock('../src/domain/owner.js')
    }

    expect(errors).toEqual(['database is read-only'])
    expect(process.exitCode).toBe(1)
  })
})
