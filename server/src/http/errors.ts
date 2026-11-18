// How errors leave the app API: as JSON with a code and a plain sentence.

import type { FastifyInstance } from 'fastify'
import { AppError } from '../errors.js'

/**
 * An AppError reaches the caller as written. Fastify's own client errors (a
 * malformed body, a 429 from a rate limit) keep their status. Anything else
 * is a bug: it is logged, and the caller gets a generic message that gives
 * nothing about the server away.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.status)
        .send({ error: error.code, message: error.message, details: error.details })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: 'bad_request', message: error.message })
    }
    request.log.error(error)
    return reply
      .status(500)
      .send({ error: 'internal', message: 'Something went wrong on the server' })
  })
}
