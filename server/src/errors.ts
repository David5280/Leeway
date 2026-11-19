// Errors with plain messages that reach the person or agent as written.

/** An error meant for the caller: shown to the person in the app and to the agent over MCP. */
export type ErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'unauthorized'
  | 'forbidden'
  | 'not_configured'
  | 'bank_error'
  | 'duplicate_bank'
  | 'mail_error'
  | 'wrong_password'
  | 'too_many_attempts'
  | 'file_too_large'
  | 'unsupported_file'
  | 'reader_error'
  | 'ai_limit'

const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  unauthorized: 401,
  forbidden: 403,
  not_configured: 503,
  bank_error: 502,
  duplicate_bank: 409,
  mail_error: 502,
  wrong_password: 400,
  too_many_attempts: 429,
  file_too_large: 413,
  unsupported_file: 415,
  reader_error: 502,
  ai_limit: 429,
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

/**
 * The message of anything thrown, for a log line or a stored failure note.
 * Not everything thrown is an Error, and `(error as Error).message` would be
 * undefined for a thrown string.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Postgres unique_violation, e.g. a duplicate category name. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}
