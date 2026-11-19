// The web app's only way to the server. Actions are typed straight from the
// server's own definitions, so a change there shows up here as a type error.

import type { z } from 'zod'
import type { ActionName, Actions } from '../../../server/src/actions/index.js'
import type { PaystubRead } from '../../../server/src/domain/paystubs/reader.js'

type ActionOf<N extends ActionName> = Extract<Actions, { name: N }>
export type Input<N extends ActionName> = z.input<ActionOf<N>['input']>
export type Output<N extends ActionName> = Awaited<ReturnType<ActionOf<N>['run']>>
export type { ActionName }

export type Settings = Output<'get_settings'>
export type Budget = Output<'get_budget'>
export type CategoryBudget = Budget['categories'][number]
export type Category = Output<'list_categories'>[number]
export type Rule = Output<'list_rules'>[number]
export type Transaction = Output<'list_transactions'>['transactions'][number]
export type Account = Output<'list_accounts'>[number]
export type Connection = Output<'list_connections'>[number]
export type SpendingPace = Output<'get_spending_pace'>
export type Bill = Output<'list_bills'>['bills'][number]
export type RecurringSeries = Output<'find_recurring'>[number]
export type Goal = Output<'list_goals'>[number]
export type DebtPlans = Output<'plan_debt_payoff'>
export type NetWorth = Output<'get_net_worth'>
export type CashFlow = Output<'get_cash_flow'>
export type AccountAlert = Output<'list_alerts'>[number]
export type AccountsView = Output<'summarize_accounts'>

/**
 * A failure the server explained: its HTTP status, error code, a message for
 * people, and any details a screen can act on (like the login a duplicate_bank
 * refusal offers to keep).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

/** Called when the server says the session ended, so the app can show sign-in. */
let onSignedOut: () => void = () => {}
export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler
}

/** Said when the server cannot be reached, or a proxy in front of it answers instead. */
export const UNREACHABLE =
  "Leeway's server is not answering. Check that it is running, then try again in a minute."

/** Statuses a proxy sends while Leeway itself is down or restarting, with no message of ours. */
const PROXY_DOWN = new Set([502, 503, 504])

/** Sends one request, turning an error reply into an ApiError and a lapsed session into sign-in. */
export function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  return send<T>(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/**
 * Sends a file as the whole request body, for the one route that takes a
 * file. Its type is only a hint: the server tells the type from the bytes.
 */
export function upload<T>(path: string, file: Blob): Promise<T> {
  return send<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
}

/** Fetches a text file the server serves, like the widget script, failing as `request` does. */
export function requestText(path: string): Promise<string> {
  return send<string>(path, { method: 'GET' }, (response) => response.text())
}

/** JSON, or an empty object for a reply with no body worth reading. */
const readJson = (response: Response): Promise<unknown> => response.json().catch(() => ({}))

async function send<T>(
  path: string,
  init: RequestInit,
  read: (response: Response) => Promise<unknown> = readJson,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin' })
  } catch {
    // fetch only throws when no answer came at all: offline, or the server is down.
    throw new ApiError(0, 'unreachable', UNREACHABLE)
  }
  if (response.status === 204) return undefined as T
  if (!response.ok) {
    // The error body; details carry what the app can act on, like a duplicate bank's logins.
    const data = (await readJson(response)) as {
      error?: string
      message?: string
      details?: unknown
    }
    if (response.status === 401 && !path.startsWith('/api/auth/')) onSignedOut()
    const fallback = PROXY_DOWN.has(response.status)
      ? UNREACHABLE
      : 'Something went wrong. Please try again.'
    throw new ApiError(
      response.status,
      data.error ?? 'error',
      data.message ?? fallback,
      data.details,
    )
  }
  return (await read(response)) as T
}

/** Runs a server action by name, typed by the server's own definition. */
export async function call<N extends ActionName>(name: N, input?: Input<N>): Promise<Output<N>> {
  const { result } = await request<{ result: Output<N> }>(
    'POST',
    `/api/actions/${name}`,
    input ?? {},
  )
  return result
}

/** What the server says about itself before anyone signs in. */
export interface Status {
  version: string
  hasOwner: boolean
  onboarded: boolean
  bank: { provider: string; environment: string } | null
  publicUrl: string | null
  /** What Leeway runs on, so setup can say where its settings and log are. */
  platform: 'railway' | 'docker' | 'other'
  /** Where the setup code came from, until the owner exists; never the code itself. */
  setupCodeFrom: 'variable' | 'log' | null
}

export interface Owner {
  email: string
  name: string | null
  onboarded: boolean
}

/** Sign-in and account routes, which sit outside the actions. */
export const auth = {
  status: () => request<Status>('GET', '/api/status'),
  me: () => request<{ owner: Owner }>('GET', '/api/auth/me'),
  checkSetupCode: (setupCode: string) =>
    request<void>('POST', '/api/auth/setup-code', { setupCode }),
  setup: (input: { email: string; password: string; name?: string; setupCode: string }) =>
    request<{ owner: Owner }>('POST', '/api/auth/setup', input),
  login: (input: { email: string; password: string }) =>
    request<{ owner: Owner }>('POST', '/api/auth/login', input),
  logout: () => request<void>('POST', '/api/auth/logout'),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<void>('POST', '/api/auth/password', input),
}

/** Paystub import: reading a file, which sits outside the actions because it takes a file. */
export const paystubs = {
  /** The figures on a paystub, for the owner to review; nothing is saved. */
  read: async (file: Blob) =>
    (await upload<{ result: PaystubRead }>('/api/paystubs/read', file)).result,
}
