// The MCP endpoint: every action an agent may use, exposed as a tool.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { runAction, type AnyAction } from '../actions/action.js'
import { actionList } from '../actions/index.js'
import type { AppContext } from '../context.js'
import { AppError } from '../errors.js'

export const MCP_INSTRUCTIONS = `Leeway is the owner's personal finance manager: budgets, transactions, accounts and bank sync.
- Money is always in integer cents. Transaction amounts are positive for money out and negative for money in.
- Dates are YYYY-MM-DD in the owner's time zone.
- Start with get_budget for how the current period is going; it includes alerts.
- A category picked by hand sticks; to categorize future transactions too, create a rule.
- Bank access is read-only. Nothing here can move money.`

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
    { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS },
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
          ? `${request.params.name} changes data, and this token is read-only. The owner can create a write token in Leeway under Settings > AI agents.`
          : `Unknown tool ${request.params.name}`,
      )
    }
    try {
      const result = await runAction(ctx, action, request.params.arguments ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      if (error instanceof AppError) return errorResult(error.message)
      onError(error)
      return errorResult(UNEXPECTED_TOOL_ERROR)
    }
  })

  return server
}
