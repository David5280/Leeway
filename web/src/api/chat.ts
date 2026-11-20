// Chat's way to the server: whether Chat is on, and a question sent to
// POST /api/chat, whose answer streams back as server-sent events.

import type { ChatEvent } from '../../../server/src/chat/turn.js'
import { ApiError, errorFrom, UNREACHABLE } from './client'
import { useAction } from './hooks'

export type { ChatEvent }

const CHAT_PATH = '/api/chat'

/** Said when the stream ends without an answer, like a dropped connection. */
export const STOPPED = 'The answer stopped partway. Ask again in a moment.'

/**
 * Whether Chat is on: only when the server has an Anthropic key, which
 * changes only when the server restarts. Undefined while unknown.
 */
export function useChatAvailable(): boolean | undefined {
  const status = useAction('get_chat_status', undefined, { staleTime: Infinity })
  if (status.isError) return false
  return status.data?.available
}

/** The events in a piece of the stream, and what is left over for the next piece. */
export function readEvents(buffer: string): { events: ChatEvent[]; rest: string } {
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  const events = blocks.flatMap((block) => {
    const data = block.split('\n').find((line) => line.startsWith('data: '))
    return data ? [JSON.parse(data.slice('data: '.length)) as ChatEvent] : []
  })
  return { events, rest }
}

/**
 * Asks a question, calling onEvent for each event as it arrives. A refusal
 * before the answer starts throws an ApiError; once it streams, a failure
 * comes as an error event. Stopping it with the signal ends quietly.
 */
export async function askChat(
  message: string,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(CHAT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      credentials: 'same-origin',
      signal,
    })
  } catch {
    if (signal?.aborted) return
    throw new ApiError(0, 'unreachable', UNREACHABLE)
  }
  if (!response.ok) throw await errorFrom(response, CHAT_PATH)
  await readStream(response, onEvent, signal)
}

async function readStream(
  response: Response,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let ended = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const read = readEvents(buffer + decoder.decode(value, { stream: true }))
      buffer = read.rest
      for (const event of read.events) {
        ended ||= event.type === 'done' || event.type === 'error'
        onEvent(event)
      }
    }
  } catch {
    if (signal?.aborted) return
  }
  if (!ended && !signal?.aborted) onEvent({ type: 'error', message: STOPPED })
}
