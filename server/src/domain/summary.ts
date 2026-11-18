// The dashboard summary: Leeway's own words by default, or Claude's when the
// owner turns it on and the server has an Anthropic key. Claude's summary is
// saved per day and reused, so a busy dashboard costs a few calls a day.

import { createHash } from 'node:crypto'
import type { AppContext } from '../context.js'
import type { IsoDate } from '../lib/dates.js'
import { formatWholeCents } from '../lib/money.js'
import { getCheckin } from './checkin.js'
import type { Settings } from './settings.js'
import { plainSummary, summaryFacts, type SummaryFacts, type SummaryText } from './summaryText.js'

/**
 * Where the AI summary stands, so the app can explain what it shows:
 * off (the owner has not turned it on), no_key (turned on, but the server has
 * no Anthropic key), on, or unavailable (writing failed; Leeway's words show).
 */
export type AiSummaryState = 'off' | 'no_key' | 'on' | 'unavailable'

export interface Summary extends SummaryText {
  /** "Leeway" for its own words, else the writer's name, like "Claude". */
  writtenBy: string
  /** When the words were written: now for Leeway's, earlier for a saved one. */
  writtenAt: string
  ai: AiSummaryState
}

/** A saved summary is reused for this long even after the numbers move. */
export const REUSE_HOURS = 4
/** After a failed try, wait this long before trying again. */
export const RETRY_AFTER_MINUTES = 60

const HOUR = 3_600_000

interface SavedRow {
  factsHash: string
  headline: string | null
  points: string[] | null
  error: string | null
  createdAt: Date
}

const hashOf = (facts: SummaryFacts) =>
  createHash('sha256').update(JSON.stringify(facts)).digest('hex')

/**
 * Writes in progress, by day and facts, so two loads at once (say, a phone
 * and a laptop) share one call instead of paying for two.
 */
const writing = new Map<string, Promise<SummaryText>>()

export async function getSummary(
  ctx: AppContext,
  settings: Settings,
  today: IsoDate,
): Promise<Summary> {
  const now = ctx.now()
  const checkin = await getCheckin(ctx.db, settings, now, today)
  // Whole dollars: the summary is a glance, and the cards below give exact amounts.
  const money = (cents: number) => formatWholeCents(cents, settings.currency, settings.locale)
  const own = (ai: AiSummaryState): Summary => ({
    ...plainSummary(checkin, settings, money),
    writtenBy: 'Leeway',
    writtenAt: now.toISOString(),
    ai,
  })

  if (!settings.aiSummary) return own('off')
  const writer = ctx.writer
  if (!writer) return own('no_key')

  const facts = summaryFacts(checkin, settings, money)
  const factsHash = hashOf(facts)
  const saved = await savedSummary(ctx, today)
  const age = saved ? now.getTime() - saved.createdAt.getTime() : Infinity

  if (saved?.headline && saved.points) {
    // Reuse it while the numbers are unchanged, or while it is recent enough.
    if (saved.factsHash === factsHash || age < REUSE_HOURS * HOUR) {
      return {
        headline: saved.headline,
        points: saved.points,
        writtenBy: writer.name,
        writtenAt: saved.createdAt.toISOString(),
        ai: 'on',
      }
    }
  } else if (saved?.error && age < RETRY_AFTER_MINUTES * 60_000) {
    return own('unavailable')
  }

  const key = `${today}:${factsHash}`
  let pending = writing.get(key)
  if (!pending) {
    pending = writer.write(facts).finally(() => writing.delete(key))
    writing.set(key, pending)
  }
  try {
    const text = await pending
    await saveSummary(ctx, today, factsHash, { text })
    return { ...text, writtenBy: writer.name, writtenAt: now.toISOString(), ai: 'on' }
  } catch (error) {
    await saveSummary(ctx, today, factsHash, { error: (error as Error).message })
    return own('unavailable')
  }
}

async function savedSummary(ctx: AppContext, day: IsoDate): Promise<SavedRow | null> {
  const { rows } = await ctx.db.query<SavedRow>(
    `SELECT facts_hash AS "factsHash", headline, points, error, created_at AS "createdAt"
     FROM ai_summaries WHERE day = $1`,
    [day],
  )
  return rows[0] ?? null
}

/** Saves today's summary or failure over any earlier one, and drops older days. */
async function saveSummary(
  ctx: AppContext,
  day: IsoDate,
  factsHash: string,
  result: { text: SummaryText } | { error: string },
): Promise<void> {
  const text = 'text' in result ? result.text : null
  const error = 'error' in result ? result.error.slice(0, 500) : null
  await ctx.db.query(
    `INSERT INTO ai_summaries (day, facts_hash, headline, points, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (day) DO UPDATE SET facts_hash = $2, headline = $3, points = $4, error = $5,
       created_at = $6`,
    [
      day,
      factsHash,
      text?.headline ?? null,
      text ? JSON.stringify(text.points) : null,
      error,
      ctx.now(),
    ],
  )
  await ctx.db.query('DELETE FROM ai_summaries WHERE day < $1', [day])
}
