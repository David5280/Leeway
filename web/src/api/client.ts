import type { z } from 'zod'
import type { ActionName, Actions } from '../../../server/src/actions/index.js'

/**
 * The web app's only way to the server. Actions are typed straight from the
 * server's own definitions, so a change there shows up here as a type error.
 */
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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Called when the server says the session ended, so the app can show sign-in. */
let onSignedOut: () => void = () => {}
export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler
}

export async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 204) return undefined as T
  const data = (await response.json().catch(() => ({}))) as {
    error?: string
    message?: string
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) onSignedOut()
    throw new ApiError(
      response.status,
      data.error ?? 'error',
      data.message ?? 'Something went wrong. Please try again.',
    )
  }
  return data as T
}

export async function call<N extends ActionName>(name: N, input?: Input<N>): Promise<Output<N>> {
  const { result } = await request<{ result: Output<N> }>(
    'POST',
    `/api/actions/${name}`,
    input ?? {},
  )
  return result
}

export interface Status {
  version: string
  hasOwner: boolean
  onboarded: boolean
  bank: { provider: string; environment: string } | null
  publicUrl: string | null
}

export interface Owner {
  email: string
  name: string | null
  onboarded: boolean
}

export const auth = {
  status: () => request<Status>('GET', '/api/status'),
  me: () => request<{ owner: Owner }>('GET', '/api/auth/me'),
  setup: (input: { email: string; password: string; name?: string }) =>
    request<{ owner: Owner }>('POST', '/api/auth/setup', input),
  login: (input: { email: string; password: string }) =>
    request<{ owner: Owner }>('POST', '/api/auth/login', input),
  logout: () => request<void>('POST', '/api/auth/logout'),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<void>('POST', '/api/auth/password', input),
}
