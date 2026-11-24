// Asking Chat a question: the question and answer while it streams, then
// the kept exchange added to the conversation.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { askChat, type ChatEvent, type ScreenContext } from '../../api/chat'
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
  /** The answer that last finished here, for screen readers to announce. */
  finished: string | null
  /** Sends a question, with the screen (and card) it was asked from when known. */
  ask: (question: string, context?: ScreenContext) => void
}

/**
 * Sends questions one at a time. A failed question is handed back through
 * onFailed, so the owner can send it again without typing it twice.
 *
 * Leaving the page stops reading the answer, but the server still finishes
 * and keeps it. A question asked while that one is still being answered is
 * refused as a conflict, which is no problem: it is handed back, and
 * get_chat is read again, which says an answer is under way (Chat.tsx waits
 * for it).
 */
export function useAsk(onFailed: (question: string) => void): Asking {
  const client = useQueryClient()
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<Unanswered | null>(null)
  const [finished, setFinished] = useState<string | null>(null)
  const stop = useRef<AbortController | null>(null)
  useEffect(() => () => stop.current?.abort(), [])

  const refresh = () => void client.invalidateQueries({ queryKey: CHAT_KEY })

  const fail = (question: string, message: string, limit = false) => {
    setPending(null)
    setError({ message, limit })
    onFailed(question)
  }

  const refused = (question: string, failure: unknown) => {
    if (failure instanceof ApiError && failure.code === 'conflict') {
      setPending(null)
      onFailed(question)
      refresh()
      return
    }
    const limit = failure instanceof ApiError && failure.code === 'ai_limit'
    fail(question, (failure as Error).message, limit)
  }

  const handle = (question: string, event: ChatEvent) => {
    if (event.type === 'text') {
      setPending((now) => now && { ...now, text: now.text + event.text, tool: null })
    } else if (event.type === 'tool') {
      setPending((now) => now && { ...now, tool: event.title })
    } else if (event.type === 'error') {
      fail(question, event.message)
    } else if (event.type === 'cleared') {
      // Started over elsewhere while this was answered: nothing was kept.
      setPending(null)
      refresh()
    } else {
      client.setQueryData<ChatView>(CHAT_KEY, (chat) =>
        chat ? { ...chat, messages: [...chat.messages, event.question, event.answer] } : chat,
      )
      setPending(null)
      setFinished(event.answer.text)
      // The day's allowance moved; the facts may have too.
      refresh()
    }
  }

  const ask = (text: string, context?: ScreenContext) => {
    const question = text.trim()
    if (!question || pending) return
    const controller = new AbortController()
    stop.current = controller
    setError(null)
    setFinished(null)
    setPending({ question, text: '', tool: null })
    const onEvent = (event: ChatEvent) => handle(question, event)
    askChat(question, onEvent, controller.signal, context).catch((failure: unknown) =>
      refused(question, failure),
    )
  }

  return { pending, error, finished, ask }
}
