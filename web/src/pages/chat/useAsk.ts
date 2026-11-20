// Asking Chat a question: the question and answer while it streams, then
// the kept exchange added to the conversation.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { askChat, type ChatEvent } from '../../api/chat'
import { ApiError, type Output } from '../../api/client'

type ChatView = Output<'get_chat'>

/** get_chat's cached read, as useAction keys it. */
export const CHAT_KEY = ['action', 'get_chat', {}]

/** The question being answered, with what has streamed so far. */
export interface Pending {
  question: string
  text: string
  /** The tool running now, by its title, like "Money check-in". */
  tool: string | null
}

/** Why a question went unanswered; a limit is a pause, not a problem. */
export interface Unanswered {
  message: string
  limit: boolean
}

export interface Asking {
  pending: Pending | null
  error: Unanswered | null
  ask: (question: string) => void
}

/**
 * Sends questions one at a time. A failed question is handed back through
 * onFailed, so the owner can send it again without typing it twice.
 */
export function useAsk(onFailed: (question: string) => void): Asking {
  const client = useQueryClient()
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<Unanswered | null>(null)
  const stop = useRef<AbortController | null>(null)
  useEffect(() => () => stop.current?.abort(), [])

  const fail = (question: string, message: string, limit = false) => {
    setPending(null)
    setError({ message, limit })
    onFailed(question)
  }

  const handle = (question: string, event: ChatEvent) => {
    if (event.type === 'text') {
      setPending((now) => now && { ...now, text: now.text + event.text, tool: null })
    } else if (event.type === 'tool') {
      setPending((now) => now && { ...now, tool: event.title })
    } else if (event.type === 'error') {
      fail(question, event.message)
    } else {
      client.setQueryData<ChatView>(CHAT_KEY, (chat) =>
        chat ? { ...chat, messages: [...chat.messages, event.question, event.answer] } : chat,
      )
      setPending(null)
      // The day's allowance moved; the facts may have too.
      void client.invalidateQueries({ queryKey: CHAT_KEY })
    }
  }

  const ask = (text: string) => {
    const question = text.trim()
    if (!question || pending) return
    const controller = new AbortController()
    stop.current = controller
    setError(null)
    setPending({ question, text: '', tool: null })
    askChat(question, (event) => handle(question, event), controller.signal).catch(
      (failure: unknown) =>
        fail(
          question,
          (failure as Error).message,
          failure instanceof ApiError && failure.code === 'ai_limit',
        ),
    )
  }

  return { pending, error, ask }
}
