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

const SESSION_COOKIE = 'leeway_session'

/** Per address: a person mistyping is never slowed, a script guessing is. */
const PER_ADDRESS_LIMIT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

/**
 * Wrong passwords allowed across every address before sign-in pauses. At
 * most 80 guesses an hour reach the password, however many addresses an
 * attacker has; the owner waits at most this window while under attack.
 */
export const ACCOUNT_LIMIT = { maxFailures: 20, windowMs: 15 * 60_000 }

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

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireSession = sessionGuard(ctx)
  const wrongPasswords = new AttemptLimiter({ ...ACCOUNT_LIMIT, now: () => ctx.now().getTime() })

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

  /** Refuses while too many wrong passwords have come in lately, before any is checked. */
  const checkNotPaused = (reply: FastifyReply) => {
    const waitMs = wrongPasswords.waitMs()
    if (waitMs === 0) return
    const minutes = Math.ceil(waitMs / 60_000)
    reply.header('Retry-After', Math.ceil(waitMs / 1000))
    throw new AppError(
      'too_many_attempts',
      `Too many wrong passwords. Sign-in is paused for ${minutes} minute${minutes === 1 ? '' : 's'}; try again then.`,
    )
  }

  app.post('/api/auth/setup', PER_ADDRESS_LIMIT, async (request, reply) => {
    const input = parseBody(credentials, request.body)
    const owner = await createOwner(ctx.db, input)
    await startSession(request, reply)
    return { owner }
  })

  app.post('/api/auth/login', PER_ADDRESS_LIMIT, async (request, reply) => {
    const { email, password } = parseBody(credentials, request.body)
    checkNotPaused(reply)
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
      checkNotPaused(reply)
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
