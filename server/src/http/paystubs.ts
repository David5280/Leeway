// The one route that takes a file: a paystub to read, sent as the raw bytes
// of the request body so nothing is re-encoded and the size limit holds
// before any of it is read. The file stays in memory for the request and is
// never written to disk or to the database.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AppContext } from '../context.js'
import { MAX_UPLOAD_BYTES, tooLarge } from '../domain/paystubs/files.js'
import { AppError } from '../errors.js'
import { perMinute } from './rateLimit.js'

/** Uploads from one address a minute: the hourly cap on paid reads is in PaystubReader. */
const UPLOADS_PER_MINUTE = 10

/** Fastify's code for a body over the route's limit. */
const BODY_TOO_LARGE = 'FST_ERR_CTP_BODY_TOO_LARGE'

const NOT_CONFIGURED =
  'Paystub import needs an Anthropic API key. Set ANTHROPIC_API_KEY on the server to turn it on.'

/**
 * POST /api/paystubs/read: the figures on a paystub, for the owner to review
 * before anything is saved (save_paystub saves them). Only the owner may send
 * one, checked before the body is read, so nobody else can make the server
 * hold a file.
 */
export async function registerPaystubRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  requireSession: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
  // A scope of its own, so taking any body as raw bytes changes no other route.
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    // The file's type is told from its first bytes (files.ts), never from the header.
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body)
    })
    // Over the limit, the owner learns how large a paystub may be.
    scope.setErrorHandler((error: Error & { code?: string }) => {
      throw error.code === BODY_TOO_LARGE ? tooLarge() : error
    })

    scope.post(
      '/api/paystubs/read',
      { onRequest: requireSession, bodyLimit: MAX_UPLOAD_BYTES, ...perMinute(UPLOADS_PER_MINUTE) },
      async (request) => {
        if (!ctx.paystubs) throw new AppError('not_configured', NOT_CONFIGURED)
        if (!Buffer.isBuffer(request.body)) {
          throw new AppError('invalid_input', 'Choose a paystub file to upload.')
        }
        return { result: await ctx.paystubs.read(request.body, request.log) }
      },
    )
  })
}
