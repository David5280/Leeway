// The pure parts of answering in Chat: which past messages go with a
// question, and the answer kept when the model stops.

import type { AiChatStop, AiMessage } from '../ai/provider.js'
import type { ChatMessage } from '../domain/chat/store.js'

/** The most characters of past conversation sent with a question, to keep each call small. */
export const HISTORY_MAX_CHARS = 16_000

/** Said when the model gave no words at all. */
export const NO_ANSWER = "I don't have an answer for that. Try asking it another way."

/** Added when the model declined. */
export const DECLINED =
  'I can only help with your money in Leeway: budgets, spending, bills, savings, debts and purchases.'

/** Added when an answer ran past the room it had. */
export const CUT_OFF = 'That answer ran long and was cut short. Try asking about one part of it.'

/** Added when the model kept looking past the steps a question may take. */
export const TOO_MANY_STEPS =
  'That took more looking than one question may, so this answer may be incomplete. Try asking about one part of it.'

/**
 * The past messages to send: the latest ones that fit HISTORY_MAX_CHARS,
 * starting with a question, since a conversation must.
 */
export function historyFor(messages: readonly ChatMessage[]): AiMessage[] {
  const kept: ChatMessage[] = []
  let size = 0
  for (const message of [...messages].reverse()) {
    size += message.text.length
    if (size > HISTORY_MAX_CHARS) break
    kept.unshift(message)
  }
  while (kept[0]?.role === 'assistant') kept.shift()
  return kept.map(({ role, text }) =>
    role === 'user' ? { role: 'user', text } : { role: 'assistant', text },
  )
}

/** The words of every step, a paragraph apart, as the owner saw them stream. */
export function joinSteps(steps: readonly string[]): string {
  return steps
    .map((step) => step.trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The answer to keep once the model stopped. A finished answer is its words;
 * one declined, cut off or stopped for taking too many steps keeps what was
 * written and says why it ends there.
 */
export function chatEnding(stop: AiChatStop, written: string, note?: string): string {
  const words = written.trim()
  const why = note ?? noteFor(stop)
  if (!why) return words || NO_ANSWER
  return words ? `${words}\n\n${why}` : why
}

function noteFor(stop: AiChatStop): string | null {
  if (stop === 'refused') return DECLINED
  if (stop === 'cut_off') return CUT_OFF
  return null
}
