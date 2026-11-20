// Actions for Chat: whether it is on, the conversation and what Leeway was
// told to remember, starting over, and forgetting a fact. The questions
// themselves stream over their own route (http/chat.ts).
//
// All are app-only: Chat sends the owner's words to Anthropic, and what it
// keeps is theirs to see and delete, never an assistant's.

import { z } from 'zod'
import { chatAllowance } from '../domain/chat/allowance.js'
import { clearMessages, deleteFact, listFacts, listMessages } from '../domain/chat/store.js'
import { getSettings } from '../domain/settings.js'
import { defineAction } from './action.js'

export const getChatStatusAction = defineAction({
  name: 'get_chat_status',
  title: 'Is Chat on?',
  description:
    'Whether Chat is available: only when the server has an Anthropic key. Without one, the app shows no Chat at all.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => ({ available: ctx.ai !== null }),
})

export const getChatAction = defineAction({
  name: 'get_chat',
  title: 'Chat',
  description:
    "The conversation in Chat, oldest first, what the owner told Leeway to remember, and today's use of Chat's daily allowance in tokens.",
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => {
    const settings = await getSettings(ctx.db)
    const [messages, facts, allowance] = await Promise.all([
      listMessages(ctx.db),
      listFacts(ctx.db),
      chatAllowance(ctx.db, settings, ctx.now()),
    ])
    return { available: ctx.ai !== null, messages, facts, allowance }
  },
})

export const clearChatAction = defineAction({
  name: 'clear_chat',
  title: 'Start Chat over',
  description: 'Deletes the conversation in Chat. What Leeway was told to remember stays.',
  input: z.object({}),
  scope: 'write',
  surface: 'app',
  run: async (ctx) => {
    await clearMessages(ctx.db)
    return { cleared: true }
  },
})

export const forgetFactAction = defineAction({
  name: 'forget_fact',
  title: 'Forget something',
  description: 'Deletes one thing Leeway was told to remember in Chat.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { id }) => {
    await deleteFact(ctx.db, id)
    return { forgotten: id }
  },
})
