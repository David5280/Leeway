// The tools Chat's model may use: every action an assistant with a read-only
// key may use over MCP, so Chat can look at anything and change nothing,
// plus Chat's own: one purchase check (afford.ts) and remembering what the
// owner said (memory.ts). Nothing here can move money or change a budget.

import { z } from 'zod'
import { runAction, type AnyAction } from '../actions/action.js'
import { actionList } from '../actions/index.js'
import type { AiTool, AiToolCall, AiToolResult } from '../ai/provider.js'
import type { AppContext } from '../context.js'
import type { PaymentPeople } from '../domain/chat/people.js'
import { AppError } from '../errors.js'
import { agentTools, UNEXPECTED_TOOL_ERROR } from '../mcp/server.js'
import { checkPurchaseTool } from './afford.js'
import { listRememberedTool, rememberTool } from './memory.js'
import { byLabel } from './sameLabel.js'
import { refusedSearch } from './searchGuard.js'
import { chatToolText } from './toolOutput.js'
import { withoutAbsentTools } from './toolWords.js'

/** Read-only actions Chat reaches through check_purchase instead, so a purchase has one answer. */
const ANSWERED_BY_CHECK_PURCHASE = new Set(['can_i_afford', 'when_can_i_afford'])

/** Every tool Chat may call, in a fixed order, so the cached prefix never changes. */
export const CHAT_TOOLS: readonly AnyAction[] = [
  ...agentTools('read').filter((action) => !ANSWERED_BY_CHECK_PURCHASE.has(action.name)),
  checkPurchaseTool,
  rememberTool,
  listRememberedTool,
]

const BY_NAME = new Map(CHAT_TOOLS.map((tool) => [tool.name, tool]))

/** Whether Chat has a tool by this name. */
export const isChatTool = (name: string): boolean => BY_NAME.has(name)

/** Every action Chat lacks, like track_recurring, which some read-only tools point at. */
const ABSENT = actionList.map((action) => action.name).filter((name) => !BY_NAME.has(name))

/** The tools as the model reads them, with no word of a tool it lacks (toolWords.ts). */
export function chatToolList(): AiTool[] {
  return CHAT_TOOLS.map((action) => ({
    name: action.name,
    description: withoutAbsentTools(action.description, ABSENT),
    inputSchema: z.toJSONSchema(action.input, { io: 'input' }) as Record<string, unknown>,
  }))
}

/** What the owner sees while a tool runs, like "Money check-in". */
export function toolTitle(name: string): string | null {
  return BY_NAME.get(name)?.title ?? null
}

/**
 * Runs one tool the model asked for, as an assistant over MCP would: with
 * the agent's view of the data, its input checked, and its output cleaned
 * (toolOutput.ts). A search that could confirm a hidden name is refused
 * before it runs (searchGuard.ts), and the charges like a labelled row are
 * every row of its label (sameLabel.ts). A failure goes back to the model as
 * the tool's answer, so it can explain or try again; one that is not the
 * caller's fault goes to `onError` and the model only hears that something
 * went wrong.
 */
export async function runChatTool(
  ctx: AppContext,
  call: AiToolCall,
  people: PaymentPeople,
  onError: (error: unknown) => void,
): Promise<AiToolResult> {
  const action = BY_NAME.get(call.name)
  const failed = (content: string) => ({ id: call.id, content, isError: true })
  if (!action) return failed(`Unknown tool ${call.name}`)
  const refused = refusedSearch(call.name, call.input, people)
  if (refused) return failed(refused)
  // Charges like a labelled row's are every row of its label, not its payee's (sameLabel.ts).
  const grouped = byLabel(call.name, call.input, people)
  try {
    const result: unknown = await runAction(
      { ...ctx, agent: true, chat: true },
      action,
      grouped?.input ?? call.input,
    )
    const shown = grouped ? grouped.page(result) : result
    return { id: call.id, content: chatToolText(shown, people), isError: false }
  } catch (error) {
    if (error instanceof AppError) return failed(error.message)
    onError(error)
    return failed(UNEXPECTED_TOOL_ERROR)
  }
}
