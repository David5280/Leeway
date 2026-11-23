// What the calendar fetch tests share: a linked calendar's secret address,
// the smallest calendar, and a check that a failure never repeats the secret.

import { expect } from 'vitest'
import { AppError } from '../../src/errors.js'

export const SECRET = 'https://calendar.example.com/private-abc123/basic.ics'
export const CALENDAR = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'

/** The AppError a promise fails with, checked never to repeat the secret link. */
export async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(AppError)
  // The link is a secret: no failure ever repeats it.
  expect((error as AppError).message).not.toContain('private-abc123')
  return error as AppError
}
