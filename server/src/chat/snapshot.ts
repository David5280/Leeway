// Leeway's bird's-eye snapshot of the owner's finances, which Chat's model
// reads before every answer: one compact block of plain facts, built from
// the money check-in (what can be spent now, this period, bills by payday,
// debts, the trend, what needs attention; snapshotLines.ts) and the
// financial profile's digest (pay, a typical month, accounts by kind,
// savings, the emergency fund, the savings rate, goals, retirement).
//
// Totals and kinds only, and every name that could be a person's or an
// account mask is hidden as in a tool's result (toolOutput.ts). A part that
// could not be read says so and names the tool that reads it, so the model
// reads rather than assumes.

import { insightFormat } from '../actions/savings.js'
import type { AppContext } from '../context.js'
import type { PaymentPeople } from '../domain/chat/people.js'
import { getCheckin, type Checkin } from '../domain/checkin.js'
import { profileDigest } from '../domain/profile/digest.js'
import { getFinancialProfile } from '../domain/profile/profile.js'
import { RATE_GUARD_FOR_AI } from '../domain/savings/rate.js'
import type { Settings } from '../domain/settings.js'
import type { IsoDate } from '../lib/dates.js'
import { checkinLines, type LineFormat } from './snapshotLines.js'
import { chatPlainText } from './toolOutput.js'

/** Said in place of the check-in's lines when it could not be read. */
export const CHECKIN_UNKNOWN =
  'What can be spent now, this budget period, bills due by payday, debts, net worth and what needs attention: not known, they could not be read just now (get_checkin reads them).'

/** Said in place of the profile's lines when it could not be read. */
export const PROFILE_UNKNOWN =
  'Pay, a typical month, accounts, savings, the emergency fund, the savings rate, goals and retirement: not known, they could not be read just now (get_financial_profile reads them).'

/** What the snapshot is written from; null for a part that could not be read. */
export interface SnapshotParts {
  today: IsoDate
  currency: string
  checkin: Checkin | null
  digest: string | null
}

/**
 * The digest's facts without its first line, which only repeats the date
 * and currency the snapshot opens with (digest.ts always opens with them),
 * and without the savings rate's guard, which CHAT_SYSTEM already gives
 * once (prompt.ts), so every question does not pay for it twice.
 */
function digestFacts(digest: string): string[] {
  return digest
    .split('\n')
    .slice(1)
    .map((line) => line.replace(` ${RATE_GUARD_FOR_AI}`, ''))
}

/** The snapshot as plain lines: the check-in's first, as the dashboard leads with them. Pure. */
export function snapshotText(parts: SnapshotParts, format: LineFormat): string {
  return [
    `As of ${parts.today}. Amounts in ${parts.currency}.`,
    ...(parts.checkin ? checkinLines(parts.checkin, format) : [CHECKIN_UNKNOWN]),
    ...(parts.digest === null ? [PROFILE_UNKNOWN] : digestFacts(parts.digest)),
  ].join('\n')
}

/** A snapshot, and whether every part of it could be read. */
export interface BuiltSnapshot {
  text: string
  complete: boolean
}

/**
 * Reads the check-in and the profile side by side and writes the snapshot.
 * A part that fails goes to `onError` and is said to be unknown, so one bad
 * read never takes the rest with it.
 */
export async function buildSnapshot(
  ctx: AppContext,
  settings: Settings,
  today: IsoDate,
  people: PaymentPeople,
  onError: (error: unknown) => void,
): Promise<BuiltSnapshot> {
  const format = insightFormat(settings)
  const readDigest = async () =>
    profileDigest(await getFinancialProfile(ctx.db, settings, today), format.money)
  const [checkin, digest] = await Promise.allSettled([
    getCheckin(ctx.db, settings, ctx.now(), today),
    readDigest(),
  ])
  const failures = [checkin, digest].filter((part) => part.status === 'rejected')
  failures.forEach((failure) => onError(failure.reason))
  const text = snapshotText(
    {
      today,
      currency: settings.currency,
      checkin: checkin.status === 'fulfilled' ? checkin.value : null,
      digest: digest.status === 'fulfilled' ? digest.value : null,
    },
    format,
  )
  return { text: chatPlainText(text, people), complete: failures.length === 0 }
}
