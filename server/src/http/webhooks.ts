// Bank webhooks: Plaid telling Leeway that a connection has news.

import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../context.js'
import { handleBankWebhook } from '../domain/connections.js'
import { perMinute } from './rateLimit.js'

/** Unsigned calls cost Leeway a lookup of Plaid's key, so a flood of them is cut off. */
const WEBHOOK_LIMIT = perMinute(60)

/**
 * Checks each webhook's signature, answers at once (Plaid retries slow
 * webhooks), then syncs in the background. Without a bank configured the
 * route answers 404, as if it were not there.
 */
export async function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // The signature covers the exact raw body, so this scope keeps the body as
  // a string instead of parsing it as JSON.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    )
    scope.post('/api/webhooks/plaid', WEBHOOK_LIMIT, async (request, reply) => {
      if (!ctx.bank) return reply.status(404).send()
      let webhook
      try {
        webhook = await ctx.bank.parseWebhook(String(request.body), request.headers)
      } catch (error) {
        request.log.warn({ err: error }, 'Rejected bank webhook')
        return reply.status(401).send({ error: 'unauthorized', message: 'Invalid signature' })
      }
      handleBankWebhook(ctx, webhook.itemId, webhook.event).catch((error) =>
        request.log.error({ err: error }, 'Webhook sync failed'),
      )
      return { ok: true }
    })
  })
}
