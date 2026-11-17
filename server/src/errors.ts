/** An error meant for the caller: shown to the person in the app and to the agent over MCP. */
export type ErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'unauthorized'
  | 'forbidden'
  | 'not_configured'
  | 'bank_error'

const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  unauthorized: 401,
  forbidden: 403,
  not_configured: 503,
  bank_error: 502,
}

export class AppError extends Error {
  readonly status: number

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.status = STATUS[code]
  }
}

export function notFound(what: string): AppError {
  return new AppError('not_found', `${what} not found`)
}

/** Postgres unique_violation, e.g. a duplicate category name. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}
