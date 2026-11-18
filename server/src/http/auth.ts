// Signing in to the web app: first-run setup, sign-in and out, sessions and the password.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import {
  changePassword,
  checkLogin,
  createOwner,
  createSession,
  deleteSession,
  getOwner,
  isValidSession,
  SESSION_MAX_AGE_SECONDS,
} from '../domain/owner.js'
import { AppError } from '../errors.js'
import { AttemptLimiter } from '../lib/attemptLimiter.js'
import { setupCodeMatches } from '../lib/setupCode.js'
import { MINUTE_MS, SECOND_MS } from '../lib/time.js'

const SESSION_COOKIE = 'leeway_session'

/** Per address: a person mistyping is never slowed, a script guessing is. */
const PER_ADDRESS_LIMIT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

/**
 * Wrong passwords allowed across every address before sign-in pauses. At
 * most 80 guesses an hour reach the password, however many addresses an
 * attacker has; the owner waits at most this window while under attack.
 */
export const ACCOUNT_LIMIT = { maxFailures: 20, windowMs: 15 * MINUTE_MS }

/** Reads a request body with a schema, as an error the person can read when it does not fit. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {})
  if (!result.success) {
    throw new AppError('invalid_input', result.error.issues.map((i) => i.message).join('; '))
  }
  return result.data
}

const credentials = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Enter a password').max(200),
  name: z.string().max(80).nullish(),
})

const newOwner = credentials.extend({
  setupCode: z.string().max(100).optional(),
})

const passwordChange = z.object({ currentPassword: z.string(), newPassword: z.string().max(200) })

/** A preHandler that lets a request through only with a live session cookie. */
export function sessionGuard(ctx: AppContext) {
  return async (request: FastifyRequest): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE]
    if (!token || !(await isValidSession(ctx.db, token))) {
      throw new AppError('unauthorized', 'Please sign in')
    }
  }
}

/**
 * The sign-in routes. `setupCode` is the code that may create the owner
 * account (see lib/setupCode.ts); until the account exists, nobody without it
 * can claim this install, however early they find its address.
 */
export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext, setupCode: string): void {
  const requireSession = sessionGuard(ctx)
  const clock = () => ctx.now().getTime()
  const wrongPasswords = new AttemptLimiter({ ...ACCOUNT_LIMIT, now: clock })
  const wrongSetupCodes = new AttemptLimiter({ ...ACCOUNT_LIMIT, now: clock })

  /**
   * Starts a fresh session for this browser. Any session it already had is
   * ended first, so a session never outlives a sign-in that replaced it.
   */
  const startSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const previous = request.cookies[SESSION_COOKIE]
    if (previous) await deleteSession(ctx.db, previous)
    reply.setCookie(SESSION_COOKIE, await createSession(ctx.db), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      // Secure whenever the browser reached Leeway over https (see proxyTrust.ts).
      secure: 'auto',
      maxAge: SESSION_MAX_AGE_SECONDS,
    })
  }

  /**
   * Refuses while too many wrong guesses have come in lately, before another
   * is checked. `paused` names what stops, like "Sign-in".
   */
  const checkNotPaused = (limiter: AttemptLimiter, reply: FastifyReply, paused: string) => {
    const waitMs = limiter.waitMs()
    if (waitMs === 0) return
    const minutes = Math.ceil(waitMs / MINUTE_MS)
    const unit = minutes === 1 ? 'minute' : 'minutes'
    reply.header('Retry-After', Math.ceil(waitMs / SECOND_MS))
    throw new AppError(
      'too_many_attempts',
      `Too many wrong tries. ${paused} is paused for ${minutes} ${unit}; try again then.`,
    )
  }

  app.post('/api/auth/setup', PER_ADDRESS_LIMIT, async (request, reply) => {
    const input = parseBody(newOwner, request.body)
    if (await getOwner(ctx.db)) {
      throw new AppError('conflict', 'This Leeway already has an owner; sign in instead')
    }
    checkNotPaused(wrongSetupCodes, reply, 'Setup')
    if (!input.setupCode || !setupCodeMatches(input.setupCode, setupCode)) {
      if (input.setupCode) wrongSetupCodes.recordFailure()
      throw new AppError(
        'forbidden',
        input.setupCode
          ? 'That setup code is not right. Copy it from the server log again.'
          : 'Enter the setup code from the server log.',
      )
    }
    const owner = await createOwner(ctx.db, input)
    await startSession(request, reply)
    return { owner }
  })

  app.post('/api/auth/login', PER_ADDRESS_LIMIT, async (request, reply) => {
    const { email, password } = parseBody(credentials, request.body)
    checkNotPaused(wrongPasswords, reply, 'Sign-in')
    if (!(await checkLogin(ctx.db, email, password))) {
      wrongPasswords.recordFailure()
      throw new AppError('unauthorized', 'That email and password do not match')
    }
    await startSession(request, reply)
    return { owner: await getOwner(ctx.db) }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await deleteSession(ctx.db, token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.status(204).send()
  })

  app.get('/api/auth/me', { preHandler: requireSession }, async () => ({
    owner: await getOwner(ctx.db),
  }))

  app.post(
    '/api/auth/password',
    { preHandler: requireSession, ...PER_ADDRESS_LIMIT },
    async (request, reply) => {
      const { currentPassword, newPassword } = parseBody(passwordChange, request.body)
      // A stolen session must not become a way to guess the password either.
      checkNotPaused(wrongPasswords, reply, 'Sign-in')
      try {
        await changePassword(ctx.db, currentPassword, newPassword)
      } catch (error) {
        if (error instanceof AppError && error.code === 'wrong_password') {
          wrongPasswords.recordFailure()
        }
        throw error
      }
      // Changing the password ended every session, this one included.
      await startSession(request, reply)
      return reply.status(204).send()
    },
  )
}
