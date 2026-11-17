import { expect } from 'vitest'
import { runAction } from '../src/actions/action.js'
import { findAction, type ActionName, type Actions } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { AppError } from '../src/errors.js'

/** What the named action resolves to, so tests get typed results without `any`. */
export type ActionOutput<Name extends ActionName> = Awaited<
  ReturnType<Extract<Actions, { name: Name }>['run']>
>

/** Calls actions the way the app and MCP do: raw input, validated, then run. */
export interface ActionCaller {
  call<Name extends ActionName>(name: Name, input?: unknown): Promise<ActionOutput<Name>>
  /** Runs an action that must fail, and returns the AppError it failed with. */
  callError(name: ActionName, input?: unknown): Promise<AppError>
}

/**
 * Binds a caller to a test context. The context is read lazily because test
 * files create it in beforeAll, after this runs at module load.
 */
export function actionCaller(getContext: () => AppContext): ActionCaller {
  const call = async <Name extends ActionName>(
    name: Name,
    input: unknown = {},
  ): Promise<ActionOutput<Name>> => {
    const action = findAction(name)
    if (!action) throw new Error(`No action named ${name}`)
    const result: ActionOutput<Name> = await runAction(getContext(), action, input)
    return result
  }

  const callError = async (name: ActionName, input: unknown = {}): Promise<AppError> => {
    const error: unknown = await call(name, input).then(
      () => null,
      (failure: unknown) => failure,
    )
    if (error === null) throw new Error(`${name} did not fail`)
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }

  return { call, callError }
}
