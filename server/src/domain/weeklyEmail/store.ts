// The weekly email's one stored row: the owner's choices and a record of sends.

import { z } from 'zod'
import type { Db } from '../../db/pool.js'
import type { SendRecord, WeeklyTime } from './schedule.js'

/** Everything stored about the weekly email. */
export interface WeeklyEmailRow extends SendRecord, WeeklyTime {
  /** Null sends to the owner's sign-in email. */
  sendTo: string | null
  sentAt: Date | null
  lastError: string | null
  lastErrorAt: Date | null
  testSentAt: Date | null
  revision: number
}

/** What the owner can change. Every field is optional; only the ones given change. */
export const weeklyEmailPatchSchema = z
  .object({
    on: z.boolean(),
    // Null (or blank) goes back to the owner's sign-in email.
    sendTo: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.union([z.literal(''), z.email('Enter a valid email address').max(254)]))
      .nullable()
      .transform((address) => address || null),
    weekday: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
  })
  .partial()
  .strict()

export type WeeklyEmailPatch = z.output<typeof weeklyEmailPatchSchema>

/** A failure's message is shown in the app, so very long ones are cut. */
const MAX_ERROR_LENGTH = 500

const COLUMNS = `enabled AS "on", send_to AS "sendTo", weekday, hour,
  scheduled_since AS "scheduledSince", sent_slot AS "sentSlot", sent_at AS "sentAt",
  attempt_slot AS "attemptSlot", attempt_at AS "attemptAt", attempts,
  last_error AS "lastError", last_error_at AS "lastErrorAt", test_sent_at AS "testSentAt",
  revision`

export async function getWeeklyEmail(db: Db): Promise<WeeklyEmailRow> {
  const { rows } = await db.query<WeeklyEmailRow>(`SELECT ${COLUMNS} FROM weekly_email`)
  return rows[0]!
}

/**
 * Saves the owner's changes. Turning it on, or moving its day or hour,
 * restarts the schedule from now, so the first email after the change goes
 * out at the next chosen time and never straight away for a time already past.
 */
export async function updateWeeklyEmail(
  db: Db,
  patch: WeeklyEmailPatch,
  now: Date,
): Promise<WeeklyEmailRow> {
  // One statement, so two changes at once cannot undo each other. On the
  // right of SET, columns are the values before this change; a null
  // parameter leaves its column as it is.
  const { rows } = await db.query<WeeklyEmailRow>(
    `UPDATE weekly_email SET
       enabled = coalesce($1::boolean, enabled),
       send_to = CASE WHEN $2::boolean THEN $3 ELSE send_to END,
       weekday = coalesce($4::smallint, weekday),
       hour = coalesce($5::smallint, hour),
       scheduled_since = CASE
         WHEN coalesce($1::boolean, enabled) AND NOT enabled THEN $6
         WHEN coalesce($4::smallint, weekday) <> weekday THEN $6
         WHEN coalesce($5::smallint, hour) <> hour THEN $6
         ELSE scheduled_since
       END,
       revision = revision + 1
     RETURNING ${COLUMNS}`,
    [
      patch.on ?? null,
      // A null address is a real choice (the sign-in email), so whether it was given is separate.
      patch.sendTo !== undefined,
      patch.sendTo ?? null,
      patch.weekday ?? null,
      patch.hour ?? null,
      now,
    ],
  )
  return rows[0]!
}

/**
 * Claims a scheduled moment for sending, only if the row is as it was read
 * (same revision). When two servers race, one claim succeeds and the other
 * finds the revision moved on and leaves it, so the email goes out once.
 */
export async function claimSlot(
  db: Db,
  seen: Pick<WeeklyEmailRow, 'revision'>,
  slot: Date,
  now: Date,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE weekly_email SET attempt_slot = $1, attempt_at = $2,
       attempts = CASE WHEN attempt_slot = $1 THEN attempts + 1 ELSE 1 END,
       revision = revision + 1
     WHERE revision = $3`,
    [slot, now, seen.revision],
  )
  return rowCount === 1
}

export async function recordSent(db: Db, slot: Date, now: Date): Promise<void> {
  await db.query(
    `UPDATE weekly_email SET sent_slot = $1, sent_at = $2, last_error = NULL,
       last_error_at = NULL, revision = revision + 1`,
    [slot, now],
  )
}

export async function recordFailure(db: Db, message: string, now: Date): Promise<void> {
  await db.query(
    `UPDATE weekly_email SET last_error = $1, last_error_at = $2, revision = revision + 1`,
    [message.slice(0, MAX_ERROR_LENGTH), now],
  )
}

/**
 * Notes a test email, only if the last one was at least `cooldownSeconds`
 * ago. Checked and written in one statement, so two quick presses send one.
 */
export async function claimTestSend(db: Db, now: Date, cooldownSeconds: number): Promise<boolean> {
  const { rowCount } = await db.query(
    // No revision bump: a test leaves the schedule alone, so a send in flight keeps its claim.
    `UPDATE weekly_email SET test_sent_at = $1
     WHERE test_sent_at IS NULL OR test_sent_at <= $1::timestamptz - make_interval(secs => $2)`,
    [now, cooldownSeconds],
  )
  return rowCount === 1
}
