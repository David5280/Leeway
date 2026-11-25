// The snapshot Chat sends with every question (snapshot.ts), built once and
// kept until the owner's data or the day changes.
//
// Why keep it: building it reads the whole picture, and its bytes must stay
// the same from question to question while nothing changed, so Anthropic's
// prompt cache keeps hitting on the context and history after it.
//
// How it is kept fresh: each question first reads a cheap fingerprint of the
// financial tables (domain/dataFingerprint.ts), which moves on any sync,
// import or edit. The snapshot is reused only while the fingerprint and the
// owner's day are the ones it was built for.

import type { AppContext } from '../context.js'
import type { PaymentPeople } from '../domain/chat/people.js'
import { dataFingerprint } from '../domain/dataFingerprint.js'
import type { Settings } from '../domain/settings.js'
import type { Db } from '../db/pool.js'
import type { IsoDate } from '../lib/dates.js'
import { buildSnapshot } from './snapshot.js'

interface Kept {
  /** The day and data fingerprint the snapshot was built for. */
  key: string
  text: string
}

/** One kept snapshot per database, so separate installs (and tests) never share one. */
const kept = new WeakMap<Db, Kept>()

/**
 * The snapshot for this question: the kept one while nothing changed, else a
 * new one. Never throws: when it can't be built at all, the error goes to
 * `onError` and the answer is null, so the question still goes through.
 */
export async function chatSnapshot(
  ctx: AppContext,
  settings: Settings,
  today: IsoDate,
  people: PaymentPeople,
  onError: (error: unknown) => void,
): Promise<string | null> {
  try {
    const key = `${today}|${await dataFingerprint(ctx.db)}`
    const hit = kept.get(ctx.db)
    if (hit?.key === key) return hit.text
    // Data written while this builds moves the fingerprint, so the next question rebuilds.
    const built = await buildSnapshot(ctx, settings, today, people, onError)
    // One with a part that failed is not kept, so the next question tries that part again.
    if (built.complete) kept.set(ctx.db, { key, text: built.text })
    else kept.delete(ctx.db)
    return built.text
  } catch (error) {
    onError(error)
    return null
  }
}
