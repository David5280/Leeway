import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getOwner } from '../src/domain/owner.js'
import { buildApp } from '../src/http/app.js'
import { MIN_PASSWORD_LENGTH } from '../src/lib/password.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
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
  app = await buildApp(ctx, { webDir: null })
})
afterEach(async () => {
  await app.close()
})

const owner = { email: 'me@example.com', password: 'correct horse battery' }

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
      email: 'Me@Example.COM',
      password: owner.password,
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

  it('asks for a password when none is given', async () => {
    const response = await post('/api/auth/setup', { email: owner.email })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_input')
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
    expect(response.json().message).toBe('Your current password is not right')
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
