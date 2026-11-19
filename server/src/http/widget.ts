// The home-screen widget's routes: its summary, read with the widget token
// alone, and the Scriptable script itself, for the owner to install.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { settingsAndToday } from '../actions/today.js'
import type { AppContext } from '../context.js'
import { getWidgetSummary, type WidgetSummary } from '../domain/widget.js'
import { verifyWidgetToken } from '../domain/widgetToken.js'
import { AppError } from '../errors.js'
import { SECOND_MS } from '../lib/time.js'
import { perMinute } from './rateLimit.js'

/**
 * Per address. A widget refreshes every few minutes at most; this only stops
 * a runaway script or someone guessing tokens.
 */
export const WIDGET_LIMIT = perMinute(30)

/** Seconds one summary is reused on the server: a phone and a Mac refreshing together share a read. */
export const SUMMARY_CACHE_SECONDS = 60

/** Where the script sits in the repository, and in the Docker image. */
const SCRIPT_PATH = join('widget', 'leeway-widget.js')

/** The name Scriptable gives the script when the owner saves the download. */
const SCRIPT_FILE_NAME = 'Leeway.js'

const NO_TOKEN = 'Add your widget token from Leeway, in Settings > Widget.'
const BAD_TOKEN = 'That widget token is not valid. Make a new one in Settings > Widget.'

/**
 * Finds the widget script by walking up from `start`, as the web app is
 * found, so it is served from the same place in development and in a build.
 */
export function findWidgetScript(
  start = dirname(fileURLToPath(import.meta.url)),
  levels = 6,
): string | null {
  let dir = start
  for (let i = 0; i < levels; i++) {
    const candidate = join(dir, SCRIPT_PATH)
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  return null
}

/** The bearer token on a request, read only from the header, never the address. */
function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization ?? ''
  return /^Bearer /i.test(header) ? header.slice(7).trim() : ''
}

/** Refuses with a 401 that tells a client which kind of token it needs. */
function refuse(reply: FastifyReply, message: string): never {
  reply.header('WWW-Authenticate', 'Bearer realm="Leeway widget"')
  throw new AppError('unauthorized', message)
}

export function registerWidgetRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  requireSession: (request: FastifyRequest) => Promise<void>,
  scriptPath: string | null,
): void {
  // One owner per install, so one cached summary is the owner's.
  let cached: { summary: WidgetSummary; expiresAt: number } | null = null

  const freshSummary = async (): Promise<WidgetSummary> => {
    const now = ctx.now()
    if (cached && cached.expiresAt > now.getTime()) return cached.summary
    const { settings, today } = await settingsAndToday(ctx)
    const summary = await getWidgetSummary(ctx.db, settings, now, today)
    cached = { summary, expiresAt: now.getTime() + SUMMARY_CACHE_SECONDS * SECOND_MS }
    return summary
  }

  /**
   * GET /api/widget: the summary, for the widget token only. A session, an
   * agent key or an OAuth token is refused, and the widget token opens
   * nothing else (every other route checks its own kind of credential).
   */
  app.get('/api/widget', WIDGET_LIMIT, async (request, reply) => {
    const token = bearerToken(request)
    if (!token) refuse(reply, NO_TOKEN)
    if (!(await verifyWidgetToken(ctx.db, token))) refuse(reply, BAD_TOKEN)
    // Kept here briefly, but like every /api answer never in a cache along the
    // way (securityHeaders.ts sets no-store).
    return freshSummary()
  })

  /** GET /api/widget/script: the Scriptable script this server's version matches, for the owner. */
  app.get('/api/widget/script', { preHandler: requireSession }, async (_request, reply) => {
    if (!scriptPath)
      throw new AppError('not_found', 'The widget script is missing from this install.')
    return reply
      .type('text/javascript; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${SCRIPT_FILE_NAME}"`)
      .send(await readFile(scriptPath, 'utf8'))
  })
}
