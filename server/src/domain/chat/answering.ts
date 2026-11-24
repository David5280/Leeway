// Chat answers one question at a time per install: a second question while
// one is still being answered would run two paid tool loops at once. Kept in
// memory, by the install's database pool, as a server runs one install.

import type pg from 'pg'

/** Installs answering a question now. */
const answering = new WeakSet<pg.Pool>()

/**
 * Claims the install for one question, or returns false when another is
 * still being answered. Synchronous, so two questions that arrive together
 * can never both claim it. Whoever claims it must call release.
 */
export function claimAnswering(db: pg.Pool): boolean {
  if (answering.has(db)) return false
  answering.add(db)
  return true
}

/** Lets the next question through. */
export function releaseAnswering(db: pg.Pool): void {
  answering.delete(db)
}

/** Whether a question is being answered now, so the app can wait for its answer. */
export function isAnswering(db: pg.Pool): boolean {
  return answering.has(db)
}
