// The MCP endpoint: every action an agent may use, exposed as a tool.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { runAction, type AnyAction } from '../actions/action.js'
import { actionList } from '../actions/index.js'
import type { AppContext } from '../context.js'
import { AppError, messageOf } from '../errors.js'
import { agentJson } from './agentOutput.js'
import { getPrompt, listPrompts } from './prompts.js'
import { withoutBankText } from './withoutBankText.js'

export const MCP_INSTRUCTIONS = `Leeway is the owner's personal finance manager: budgets, transactions, accounts, bills, savings goals, debts and bank sync. You are their money coach.
- Start with get_checkin. It lists what needs attention, most urgent first, with the numbers.
- Before advice about saving, investing or the bigger picture, read get_financial_profile: a short digest of pay, typical spending, bills, accounts by kind, the emergency fund, the savings rate and goals. summarize_savings has the detail.
- The savings rate counts money moved through the bank, the pension contributions the owner entered and the 401(k), 457 or 403(b) a paystub from the last six months shows. Any other payroll deduction is left out, so never tell the owner they save too little.
- A pension is retirement saving. When one is recorded, never call little or nothing going into a 401(k), IRA or brokerage account under-saving for retirement. Enter only pension figures the owner gives you, never a plan's rules from what you know.
- For retirement, use project_retirement. Give its projection as a range with its note, never as a promise.
- What the owner can spend now is spendable.leadCents, with spendable.perDayCents a day (get_budget, get_checkin and get_cash_flow all carry spendable): the lesser of the budget's room and safe to spend (cash in checking less bills due by payday and any overdraft), the figure the owner's dashboard leads with. Quote it, never the budget's room or safeCents on their own, and say its note when there is one.
- Pay is paychecks from the employers paying now only, a second job included; money from people, refunds and transfers in are not income. While an employer's cadence is unconfirmed (one paycheck, or paydays that fit two cadences), pay figures are cautious estimates, so say so.
- For "can I afford this?", use can_i_afford; for "when can I afford it?", use when_can_i_afford.
- To save for a purchase, use create_goal with kind "purchase" (the item, its price, by when). Its plan says what to set aside each budget period and when recent progress gets there.
- Coach plainly: lead with what matters, use real numbers, and suggest one next step. Never shame; spending choices are the owner's.
- Ask before changing a budget, category, rule or goal the owner set. Fixing what they asked you to fix, like a transaction's category, needs no extra ask.
- Money is always in integer cents. Transaction amounts are positive for money out and negative for money in.
- Dates are YYYY-MM-DD in the owner's time zone.
- A category picked by hand sticks; to categorize future transactions too, create a rule.
- Bank access is read-only. Nothing here can move money, pay a bill or cancel a subscription; tell the owner where to do it.`

/** The tools an agent can see: every action meant for agents that its token allows. */
export function agentTools(scope: 'read' | 'write'): AnyAction[] {
  return actionList.filter(
    (action) => action.surface === 'all' && (scope === 'write' || action.scope === 'read'),
  )
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** What an agent sees when a tool fails for a reason that is not its fault. */
export const UNEXPECTED_TOOL_ERROR = 'Something went wrong on the server. Try again shortly.'

/**
 * An MCP server exposing Leeway's actions as tools. A new one is made per
 * request (stateless), bound to the scope of the token that called.
 * Unexpected failures go to `onError` for the server log; the agent only gets
 * a plain message, the same as the web app, so no internals leak.
 */
export function createMcpServer(
  ctx: AppContext,
  scope: 'read' | 'write',
  version: string,
  onError: (error: unknown) => void = () => {},
): Server {
  const server = new Server(
    { name: 'leeway', title: 'Leeway', version },
    { capabilities: { tools: {}, prompts: {} }, instructions: MCP_INSTRUCTIONS },
  )
  const tools = agentTools(scope)
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((action) => ({
      name: action.name,
      title: action.title,
      description: action.description,
      inputSchema: z.toJSONSchema(action.input, { io: 'input' }) as {
        type: 'object'
        [key: string]: unknown
      },
      annotations: {
        title: action.title,
        readOnlyHint: action.scope === 'read',
        destructiveHint: action.name.startsWith('delete_') || action.name === 'import_config',
        // Everything works on local data except syncing, which calls the bank.
        openWorldHint: action.name === 'sync_banks',
      },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const action = byName.get(request.params.name)
    if (!action) {
      const exists = actionList.some((a) => a.name === request.params.name)
      return errorResult(
        exists && scope === 'read'
          ? `${request.params.name} changes data, and this token is read-only. The owner can create a key that can change data in Leeway under Settings > AI assistant.`
          : `Unknown tool ${request.params.name}`,
      )
    }
    try {
      const result = await runAction(
        { ...ctx, agent: true },
        action,
        request.params.arguments ?? {},
      )
      // The bank's text and every owner-only field stay out of what an agent reads.
      return { content: [{ type: 'text', text: agentJson(withoutBankText(result)) }] }
    } catch (error) {
      if (error instanceof AppError) return errorResult(error.message)
      onError(error)
      return errorResult(UNEXPECTED_TOOL_ERROR)
    }
  })

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: listPrompts() }))
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    try {
      return getPrompt(request.params.name, request.params.arguments)
    } catch (error) {
      // A prompt that does not exist or lacks an argument is the caller's mistake.
      throw new McpError(ErrorCode.InvalidParams, messageOf(error))
    }
  })

  return server
}
