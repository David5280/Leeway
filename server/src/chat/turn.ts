// One question in Chat: checked and let through, then answered step by step
// with tools, its text streamed as it comes, and kept with its answer.
//
// What it may cost is bounded three ways: the monthly AI limit every call
// is held against (domain/ai/gateway.ts), Chat's daily allowance checked
// before a question starts (domain/chat/allowance.ts), and here, at most
// MAX_STEPS calls of at most STEP_MAX_TOKENS output each, one question at a
// time. Each step resends only the question's history, never the tool calls
// of earlier questions.

import { AiProviderError, type AiFailure, type AiMessage } from '../ai/provider.js'
import type { AppContext } from '../context.js'
import type { AiGateway } from '../domain/ai/gateway.js'
import { AiLimitError } from '../domain/ai/limit.js'
import { allowanceMessage, chatAllowance } from '../domain/chat/allowance.js'
import { claimAnswering, releaseAnswering } from '../domain/chat/answering.js'
import { paymentPeople, type PaymentPeople } from '../domain/chat/people.js'
import { listFacts, listMessages, saveExchange, type ChatMessage } from '../domain/chat/store.js'
import { getSettings, type Settings } from '../domain/settings.js'
import { AppError } from '../errors.js'
import { todayIn } from '../lib/dates.js'
import { chatEnding, forKeeping, historyFor, joinSteps, TOO_MANY_STEPS } from './answer.js'
import { CHAT_SYSTEM, chatContext } from './prompt.js'
import { withAskedFrom, type ScreenContext } from './screen.js'
import { chatSnapshot } from './snapshotCache.js'
import { chatToolList, runChatTool, toolTitle } from './tools.js'

/** The most calls one question makes: a few looks at the data, then the answer. */
export const MAX_STEPS = 6

/** The most output one call may use, thinking included. Answers are short. */
export const STEP_MAX_TOKENS = 4000

/** The longest question, in characters. */
export const QUESTION_MAX_LENGTH = 2000

/** The past messages a question is sent with, before the size limit in historyFor. */
const HISTORY_MESSAGES = 20

/** What the owner sees while Chat answers, as the server streams it. */
export type ChatEvent =
  | { type: 'text'; text: string }
  /** A tool is running, by its title, like "Money check-in". */
  | { type: 'tool'; title: string }
  | { type: 'done'; question: ChatMessage; answer: ChatMessage }
  /** The owner started over while this was answered, so the exchange was not kept. */
  | { type: 'cleared' }
  | { type: 'error'; message: string }

export type Emit = (event: ChatEvent) => void

const NOT_CONFIGURED =
  'Chat needs an Anthropic API key. Set ANTHROPIC_API_KEY on the server to turn it on.'
const STILL_ANSWERING = 'Leeway is still answering your last question. Ask again once it has.'
const SOMETHING_WRONG = 'Something went wrong while answering. Try again in a moment.'

/** Each provider failure as something the owner can act on. */
const FAILURES: Record<AiFailure, string> = {
  key: 'The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY.',
  busy: 'Claude is busy right now. Try again in a minute.',
  too_large: 'This conversation is too long to send. Start over and ask again.',
  bad_request: 'Claude could not take this question. Try asking it another way.',
  model:
    "The AI model set for Chat isn't available from Anthropic. Choose another in Settings, then AI models.",
  rejected: 'Claude could not take the question just now. Try again in a moment.',
  unreachable: 'Leeway could not reach Claude. Try again in a moment.',
  failed: SOMETHING_WRONG,
}

export interface ChatTurn {
  /** Answers the question, telling `emit` as it goes. Never throws: a failure is an error event. */
  run(emit: Emit): Promise<void>
}

/**
 * Lets a question through, or refuses it with an AppError before anything
 * is sent: no key, an empty or overlong question, another still being
 * answered, or the day's allowance used up. The caller must then run it.
 * `askedFrom`, already checked (screen.ts), says where it was asked.
 */
export async function openTurn(
  ctx: AppContext,
  text: string,
  onError: (error: unknown) => void,
  askedFrom?: ScreenContext,
): Promise<ChatTurn> {
  const ai = ctx.ai
  if (!ai) throw new AppError('not_configured', NOT_CONFIGURED)
  const question = text.trim()
  if (!question) throw new AppError('invalid_input', 'Type a question first.')
  if (question.length > QUESTION_MAX_LENGTH) {
    throw new AppError('invalid_input', `Keep a question to ${QUESTION_MAX_LENGTH} characters.`)
  }
  // Claimed before the first await, so two questions at once can't both get through.
  if (!claimAnswering(ctx.db)) throw new AppError('conflict', STILL_ANSWERING)
  let settings: Settings
  try {
    settings = await getSettings(ctx.db)
    const limit = allowanceMessage(await chatAllowance(ctx.db, settings, ctx.now()))
    if (limit) throw new AppError('ai_limit', limit)
  } catch (error) {
    releaseAnswering(ctx.db)
    throw error
  }
  return {
    run: async (emit) => {
      try {
        await answer({ ctx, ai, settings, onError, askedFrom }, question, emit)
      } catch (error) {
        emit({ type: 'error', message: failureMessage(error, onError) })
      } finally {
        releaseAnswering(ctx.db)
      }
    },
  }
}

interface Turn {
  ctx: AppContext
  ai: AiGateway
  settings: Settings
  onError: (error: unknown) => void
  askedFrom: ScreenContext | undefined
}

async function answer(turn: Turn, question: string, emit: Emit): Promise<void> {
  const { ctx, settings, askedFrom } = turn
  const [past, facts, people] = await Promise.all([
    listMessages(ctx.db, HISTORY_MESSAGES),
    listFacts(ctx.db),
    paymentPeople(ctx.db),
  ])
  const today = todayIn(settings.timeZone, ctx.now())
  // The whole picture, read before every answer; null (never a refusal) when it can't be built.
  const snapshot = await chatSnapshot(ctx, settings, today, people, turn.onError)
  const context = chatContext(today, settings.currency, facts, snapshot)
  // The screen opens this question's message only; the question alone is kept (saveExchange).
  const asked: AiMessage = { role: 'user', text: withAskedFrom(question, askedFrom) }
  const messages: AiMessage[] = [...historyFor(past), asked]
  const steps: string[] = []
  let ending: string | null = null
  for (let step = 0; step < MAX_STEPS && ending === null; step++) {
    ending = await takeStep(turn, { context, messages, people, steps }, emit)
  }
  const text = forKeeping(ending ?? chatEnding('cut_off', joinSteps(steps), TOO_MANY_STEPS))
  // Kept only if the conversation it was asked in is still there (saveExchange).
  const saved = await saveExchange(ctx.db, question, text, ctx.now(), past.at(-1)?.id ?? null)
  emit(saved ? { type: 'done', ...saved } : { type: 'cleared' })
}

interface Conversation {
  context: string
  messages: AiMessage[]
  people: PaymentPeople
  /** The text of each step so far, streamed as it came. */
  steps: string[]
}

/**
 * One call: streams its text, then runs the tools it asked for and adds
 * their results. Returns the answer to keep once the model is done, or null
 * to take another step.
 */
async function takeStep(turn: Turn, talk: Conversation, emit: Emit): Promise<string | null> {
  const { ctx, ai, onError } = turn
  const index = talk.steps.push('') - 1
  const reply = await ai.converse(
    'chat',
    {
      system: CHAT_SYSTEM,
      context: talk.context,
      tools: chatToolList(),
      messages: talk.messages,
      effort: 'low',
      maxTokens: STEP_MAX_TOKENS,
    },
    (text) => {
      // A new step's words start a new paragraph after the last step's.
      const lead = talk.steps[index] === '' && joinSteps(talk.steps.slice(0, index)) ? '\n\n' : ''
      talk.steps[index] += text
      emit({ type: 'text', text: lead + text })
    },
  )
  if (reply.stop !== 'tools' || reply.toolCalls.length === 0) {
    return chatEnding(reply.stop, joinSteps(talk.steps))
  }
  talk.messages.push({ role: 'assistant', turn: reply.turn })
  const results = []
  for (const call of reply.toolCalls) {
    const title = toolTitle(call.name)
    if (title) emit({ type: 'tool', title })
    results.push(await runChatTool(ctx, call, talk.people, onError))
  }
  talk.messages.push({ role: 'tool_results', results })
  return null
}

/** A failure as the owner should hear it; a bug goes to `onError` as well. */
function failureMessage(error: unknown, onError: (error: unknown) => void): string {
  if (error instanceof AiLimitError || error instanceof AppError) return error.message
  if (error instanceof AiProviderError) return FAILURES[error.failure]
  onError(error)
  return SOMETHING_WRONG
}
