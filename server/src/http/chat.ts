// POST /api/chat: one question in Chat, answered as a stream of server-sent
// events, so its words show as they are written. A question refused before
// anything is sent (no key, already answering, the day's allowance used up)
// gets a plain JSON error like any action.

import { PassThrough } from 'node:stream'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { openTurn, type ChatEvent } from '../chat/turn.js'
import type { AppContext } from '../context.js'
import { AppError } from '../errors.js'
import { chatBody, refusal } from './chatBody.js'
import { perMinute } from './rateLimit.js'

/** Questions from one address a minute; each makes a few paid calls. */
const QUESTIONS_PER_MINUTE = 10

/** One event as a server-sent event: its type, then the event as JSON. */
export function serverSentEvent(event: ChatEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function registerChatRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  requireSession: (request: FastifyRequest) => Promise<void>,
): void {
  app.post(
    '/api/chat',
    { preHandler: requireSession, ...perMinute(QUESTIONS_PER_MINUTE) },
    async (request, reply) => {
      const body = chatBody.safeParse(request.body)
      if (!body.success) throw new AppError('invalid_input', refusal(body.error))
      const { message, context } = body.data
      const turn = await openTurn(
        ctx,
        message,
        (err) => request.log.error({ err }, 'Chat failed'),
        context,
      )
      const events = new PassThrough()
      void turn.run((event) => events.write(serverSentEvent(event))).finally(() => events.end())
      return (
        reply
          .header('Content-Type', 'text/event-stream; charset=utf-8')
          // Tells a proxy in front, like nginx, to pass each event on as it comes.
          .header('X-Accel-Buffering', 'no')
          .send(events)
      )
    },
  )
}
