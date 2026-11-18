// The action model: how each thing a person can do is defined, checked and run.

import type { z } from 'zod'
import type { AppContext } from '../context.js'
import { AppError } from '../errors.js'

/**
 * One thing a person can do in Leeway. The web app and the MCP endpoint both
 * call actions, so anything the app can do, an AI agent can do too, through
 * the very same code path and validation.
 *
 * - scope: 'read' actions work with any token; 'write' actions need a token
 *   with write access. No action moves money: bank access is read-only.
 * - surface: 'app' keeps an action out of MCP. Only actions that need a
 *   browser (opening a bank login) or that manage access itself are app-only.
 */
export interface Action<Name extends string, Input extends z.ZodType, Output> {
  name: Name
  title: string
  description: string
  input: Input
  scope: 'read' | 'write'
  surface: 'all' | 'app'
  run(ctx: AppContext, input: z.output<Input>): Promise<Output>
}

export function defineAction<Name extends string, Input extends z.ZodType, Output>(
  action: Action<Name, Input, Output>,
): Action<Name, Input, Output> {
  return action
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAction = Action<string, z.ZodType, any>

/** Validates raw input (from JSON or an agent) and runs the action. */
export async function runAction<Output>(
  ctx: AppContext,
  action: Action<string, z.ZodType, Output>,
  rawInput: unknown,
): Promise<Output> {
  const parsed = action.input.safeParse(rawInput ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
    const summary = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')
    throw new AppError('invalid_input', summary, issues)
  }
  return action.run(ctx, parsed.data)
}
