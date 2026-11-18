import { randomBytes, scryptSync } from 'node:crypto'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { ACCOUNT_LIMIT } from '../src/http/auth.js'
import { createOwner, getOwner } from '../src/domain/owner.js'
import { buildApp } from '../src/http/app.js'
import { MIN_PASSWORD_LENGTH } from '../src/lib/passwordRules.js'
import { createTestContext, resetData, TEST_SETUP_CODE } from './helpers.js'

let ctx: AppContext & { setNow(date: Date): void }
let app: FastifyInstance

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
// A fresh app per test, because sign-in routes are rate limited per app.
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
  app = await buildApp(ctx, { webDir: null })
})
afterEach(async () => {
  await app.close()
})

const owner = {
  email: 'me@example.com',
  password: 'correct horse battery',
  setupCode: TEST_SETUP_CODE,
}

/** The cookie header that carries the session a response just set. */
function sessionCookie(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.name === 'leeway_session')
  if (!cookie) throw new Error('No session cookie was set')
  return `leeway_session=${cookie.value}`
}

const post = (url: string, payload?: object, cookie?: string) =>
  app.inject({ method: 'POST', url, payload, headers: cookie ? { cookie } : {} })

const me = (cookie: string) => app.inject({ url: '/api/auth/me', headers: { cookie } })

async function signUp(): Promise<string> {
  const response = await post('/api/auth/setup', owner)
  expect(response.statusCode).toBe(200)
  return sessionCookie(response)
}

describe('creating the owner', () => {
  it('stores the email in lower case and a blank name as no name', async () => {
    const created = await post('/api/auth/setup', {
      ...owner,
      email: 'Me@Example.COM',
      name: '   ',
    })
    expect(created.json().owner).toEqual({ email: 'me@example.com', name: null, onboarded: false })
  })

  it('refuses an email that is not valid', async () => {
    const response = await post('/api/auth/setup', { ...owner, email: 'me at example' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'invalid_input',
      message: 'Enter a valid email',
    })
  })

  it('keeps a trimmed name', async () => {
    const created = await post('/api/auth/setup', { ...owner, name: '  David  ' })
    expect(created.json().owner.name).toBe('David')
  })

  it('refuses a short password and explains the minimum length', async () => {
    const response = await post('/api/auth/setup', { ...owner, password: 'short' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'invalid_input',
      message: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters`,
    })
    expect(await getOwner(ctx.db)).toBeNull()
  })

  it('still refuses a second owner when two setups race past the first check', async () => {
    await createOwner(ctx.db, owner)
    await expect(createOwner(ctx.db, owner)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('asks for an email and password when the request has no body at all', async () => {
    const response = await post('/api/auth/login')
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_input')
  })

  it('asks for a password when none is given', async () => {
    const response = await post('/api/auth/setup', { email: owner.email })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_input')
  })
})

describe('the setup code', { timeout: 30_000 }, () => {
  const setUp = (setupCode?: string, address = '198.51.100.1') =>
    app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: owner.email, password: owner.password, setupCode },
      headers: { 'x-forwarded-for': address },
    })

  it('refuses to create the owner without the code, and says where to find it', async () => {
    const response = await setUp(undefined)
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      error: 'forbidden',
      message: "Enter the setup code. It is SETUP_CODE in Leeway's settings.",
    })
    expect(await getOwner(ctx.db)).toBeNull()
  })

  it('refuses a wrong code and creates nothing', async () => {
    const response = await setUp('WRNG-CODE-HERE')
    expect(response.statusCode).toBe(403)
    expect(response.json().message).toBe(
      "That setup code is not right. Copy it again from SETUP_CODE in Leeway's settings.",
    )
    expect(await getOwner(ctx.db)).toBeNull()
    expect(response.cookies).toHaveLength(0)
  })

  it('points to the log for a code Leeway made up, and to Railway on Railway', async () => {
    await app.close()
    app = await buildApp(
      { ...ctx, config: { ...ctx.config, setupCode: null, platform: 'railway' } },
      { webDir: null, setupCode: 'LOGGED-CODE-5678' },
    )
    expect((await setUp('WRNG-CODE-HERE')).json().message).toBe(
      'That setup code is not right. Copy it again from the newest line in Leeway\'s log that starts "No account yet".',
    )
    await app.close()
    app = await buildApp(
      { ...ctx, config: { ...ctx.config, platform: 'railway' } },
      { webDir: null },
    )
    expect((await setUp(undefined)).json().message).toBe(
      "Enter the setup code. It is SETUP_CODE in your Leeway service's Variables on Railway.",
    )
  })

  it('accepts the code in any case, with or without its dashes and spaces', async () => {
    const response = await setUp(` ${TEST_SETUP_CODE.toLowerCase().replaceAll('-', ' ')} `)
    expect(response.statusCode).toBe(200)
  })

  it('says the install is taken before looking at any code once the owner exists', async () => {
    await signUp()
    const response = await setUp('WRNG-CODE-HERE')
    expect(response.statusCode).toBe(409)
  })

  it('pauses setup after many wrong codes from anywhere', async () => {
    for (let i = 0; i < ACCOUNT_LIMIT.maxFailures; i++) {
      expect((await setUp('WRNG-CODE-HERE', `198.51.100.${i}`)).statusCode).toBe(403)
    }
    const paused = await setUp(TEST_SETUP_CODE, '198.51.100.200')
    expect(paused.statusCode).toBe(429)
    expect(paused.json().message).toBe(
      'Too many wrong tries. Setup is paused for 15 minutes; try again then.',
    )
  })

  it('checks a code on its own, without creating the owner', async () => {
    const check = (setupCode?: string) =>
      app.inject({ method: 'POST', url: '/api/auth/setup-code', payload: { setupCode } })
    expect((await check('WRNG-CODE-HERE')).statusCode).toBe(403)
    expect((await check(undefined)).json().message).toMatch(/^Enter the setup code/)
    const right = await check(TEST_SETUP_CODE.toLowerCase())
    expect(right.statusCode).toBe(204)
    expect(right.cookies).toHaveLength(0)
    expect(await getOwner(ctx.db)).toBeNull()
    await signUp()
    expect((await check(TEST_SETUP_CODE)).statusCode).toBe(409)
  })

  it('counts wrong codes from the check toward the same pause', async () => {
    for (let i = 0; i < ACCOUNT_LIMIT.maxFailures; i++) {
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/auth/setup-code',
        payload: { setupCode: 'WRNG-CODE-HERE' },
        headers: { 'x-forwarded-for': `198.51.100.${i}` },
      })
      expect(wrong.statusCode).toBe(403)
    }
    expect((await setUp(TEST_SETUP_CODE, '198.51.100.200')).statusCode).toBe(429)
  })

  it('takes a code given to the app over the one in the configuration', async () => {
    await app.close()
    app = await buildApp(ctx, { webDir: null, setupCode: 'ANOTHER-CODE-5678' })
    expect((await setUp(TEST_SETUP_CODE)).statusCode).toBe(403)
    expect((await setUp('another-code-5678')).statusCode).toBe(200)
  })

  it('makes up a code nobody knows when none is configured, so setup is never open', async () => {
    await app.close()
    app = await buildApp({ ...ctx, config: { ...ctx.config, setupCode: null } }, { webDir: null })
    expect((await setUp(TEST_SETUP_CODE)).statusCode).toBe(403)
  })
})

describe('signing in', () => {
  it('refuses any sign-in before the owner exists', async () => {
    const response = await post('/api/auth/login', owner)
    expect(response.statusCode).toBe(401)
    expect(response.json().message).toBe('That email and password do not match')
  })

  it('refuses the right password with the wrong email', async () => {
    await signUp()
    const response = await post('/api/auth/login', { ...owner, email: 'someone@example.com' })
    expect(response.statusCode).toBe(401)
  })

  it('accepts the email in any case', async () => {
    await signUp()
    const response = await post('/api/auth/login', { ...owner, email: 'ME@example.com' })
    expect(response.statusCode).toBe(200)
    expect(response.json().owner).toMatchObject({ email: owner.email })
    expect((await me(sessionCookie(response))).statusCode).toBe(200)
  })

  it('shows the signed-in owner', async () => {
    const cookie = await signUp()
    const response = await me(cookie)
    expect(response.json()).toEqual({
      owner: { email: owner.email, name: null, onboarded: false },
    })
  })

  it('stores the password again with current settings when an older hash signs in', async () => {
    await signUp()
    // The hash an earlier Leeway made: scrypt with p=1.
    const salt = randomBytes(16)
    const hash = scryptSync(owner.password, salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 2 ** 26 })
    const older = ['scrypt', 2 ** 15, 8, 1, salt.toString('base64'), hash.toString('base64')]
    await ctx.db.query('UPDATE owner SET password_hash = $1', [older.join(':')])

    expect((await post('/api/auth/login', owner)).statusCode).toBe(200)

    const { rows } = await ctx.db.query<{ hash: string }>('SELECT password_hash AS hash FROM owner')
    expect(rows[0]!.hash).toMatch(/^scrypt:32768:8:3:/)
    expect((await post('/api/auth/login', owner)).statusCode).toBe(200)
  })

  it('ends the session a browser already had when it signs in again', async () => {
    const first = await signUp()
    const second = sessionCookie(await post('/api/auth/login', owner, first))

    expect((await me(first)).statusCode).toBe(401)
    expect((await me(second)).statusCode).toBe(200)
  })

  it('signs out cleanly even without a session', async () => {
    const response = await post('/api/auth/logout')
    expect(response.statusCode).toBe(204)
  })
})

describe('sessions', () => {
  it('stops accepting a session once it expires', async () => {
    const cookie = await signUp()
    await ctx.db.query(`UPDATE sessions SET expires_at = now() - interval '1 minute'`)

    const response = await me(cookie)

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'unauthorized', message: 'Please sign in' })
  })

  it('clears out expired sessions when a new one starts', async () => {
    await signUp()
    await ctx.db.query(`UPDATE sessions SET expires_at = now() - interval '1 minute'`)

    await post('/api/auth/login', owner)

    const { rows } = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions')
    expect(rows[0]?.n).toBe(1)
  })

  it('refuses a made-up session cookie', async () => {
    await signUp()
    expect((await me('leeway_session=not-a-real-session')).statusCode).toBe(401)
  })
})

describe('changing the password', () => {
  const change = (cookie: string, currentPassword: string, newPassword: string) =>
    post('/api/auth/password', { currentPassword, newPassword }, cookie)

  it('needs a session', async () => {
    const response = await post('/api/auth/password', {
      currentPassword: owner.password,
      newPassword: 'a whole new password',
    })
    expect(response.statusCode).toBe(401)
  })

  it('refuses a wrong current password', async () => {
    const cookie = await signUp()
    const response = await change(cookie, 'not my password', 'a whole new password')
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'wrong_password',
      message: 'Your current password is not right',
    })
  })

  it('refuses a new password that is too short, keeping the old one', async () => {
    const cookie = await signUp()
    const response = await change(cookie, owner.password, 'short')
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toContain(`at least ${MIN_PASSWORD_LENGTH} characters`)
    expect((await post('/api/auth/login', owner)).statusCode).toBe(200)
  })

  it('refuses a request missing either password', async () => {
    const cookie = await signUp()
    const response = await post('/api/auth/password', { newPassword: 'whatever' }, cookie)
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_input')
  })

  it('switches passwords, ends every old session and signs this device in again', async () => {
    const otherDevice = await signUp()
    const thisDevice = sessionCookie(await post('/api/auth/login', owner))
    const newPassword = 'a whole new password'

    const response = await change(thisDevice, owner.password, newPassword)

    expect(response.statusCode).toBe(204)
    expect((await me(otherDevice)).statusCode).toBe(401)
    expect((await me(thisDevice)).statusCode).toBe(401)
    expect((await me(sessionCookie(response))).statusCode).toBe(200)
    expect((await post('/api/auth/login', owner)).statusCode).toBe(401)
    expect((await post('/api/auth/login', { ...owner, password: newPassword })).statusCode).toBe(
      200,
    )
  })
})

describe('rate limits', () => {
  it('slows down repeated sign-in attempts with a readable error', async () => {
    const attempt = () => post('/api/auth/login', { ...owner, password: 'guess' })
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401)

    const blocked = await attempt()

    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toMatchObject({ error: 'bad_request' })
    expect(blocked.json().message).toMatch(/rate limit/i)
  })

  it('counts attempts by the address the proxy saw, whatever address the client claims', async () => {
    // Each attempt claims a new address of its own before the one the proxy recorded.
    const attempt = (i: number) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { ...owner, password: 'guess' },
        headers: { 'x-forwarded-for': `10.0.0.${i}, 198.51.100.7` },
      })
    for (let i = 0; i < 10; i++) expect((await attempt(i)).statusCode).toBe(401)

    expect((await attempt(99)).statusCode).toBe(429)
  })
})

// Each wrong password costs a real scrypt check, so these take a few seconds.
describe('pausing sign-in after many wrong passwords', { timeout: 30_000 }, () => {
  /** A sign-in from its own address, so only the account-wide limit can stop it. */
  const loginFrom = (address: number, password: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { ...owner, password },
      headers: { 'x-forwarded-for': `198.51.100.${address}` },
    })

  async function guessFromManyAddresses(): Promise<void> {
    for (let i = 0; i < ACCOUNT_LIMIT.maxFailures; i++) {
      expect((await loginFrom(i, 'a wrong guess')).statusCode).toBe(401)
    }
  }

  it('pauses every address, even with the right password, and says for how long', async () => {
    await signUp()
    await guessFromManyAddresses()

    const paused = await loginFrom(200, owner.password)

    expect(paused.statusCode).toBe(429)
    expect(paused.headers['retry-after']).toBe(String(ACCOUNT_LIMIT.windowMs / 1000))
    expect(paused.json()).toMatchObject({
      error: 'too_many_attempts',
      message: 'Too many wrong tries. Sign-in is paused for 15 minutes; try again then.',
    })
    expect(paused.cookies).toHaveLength(0)
  })

  it('opens again once the oldest wrong password is out of the window', async () => {
    await signUp()
    await guessFromManyAddresses()

    ctx.setNow(new Date(ctx.now().getTime() + ACCOUNT_LIMIT.windowMs - 30_000))
    const almost = await loginFrom(200, owner.password)
    expect(almost.json().message).toContain('paused for 1 minute;')

    ctx.setNow(new Date(ctx.now().getTime() + 30_000))
    expect((await loginFrom(201, owner.password)).statusCode).toBe(200)
  })

  it('counts wrong current passwords when changing it, so a stolen session cannot guess', async () => {
    const cookie = await signUp()
    for (let i = 0; i < ACCOUNT_LIMIT.maxFailures; i++) {
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/auth/password',
        payload: { currentPassword: 'a wrong guess', newPassword: 'a whole new password' },
        headers: { cookie, 'x-forwarded-for': `198.51.100.${i}` },
      })
      expect(wrong.statusCode).toBe(400)
    }

    const paused = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { currentPassword: owner.password, newPassword: 'a whole new password' },
      headers: { cookie, 'x-forwarded-for': '198.51.100.250' },
    })

    expect(paused.statusCode).toBe(429)
    expect((await loginFrom(251, owner.password)).statusCode).toBe(429)
  })

  it('does not count a too-short new password as a wrong guess', async () => {
    const cookie = await signUp()
    for (let i = 0; i < ACCOUNT_LIMIT.maxFailures; i++) {
      const tooShort = await app.inject({
        method: 'POST',
        url: '/api/auth/password',
        payload: { currentPassword: owner.password, newPassword: 'short' },
        headers: { cookie, 'x-forwarded-for': `198.51.100.${i}` },
      })
      expect(tooShort.statusCode).toBe(400)
    }
    expect((await loginFrom(250, owner.password)).statusCode).toBe(200)
  })
})
