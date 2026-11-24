// Chat's daily allowance: a cap on the tokens it may use in a day, on top of
// the monthly spending limit every AI job shares (domain/ai/gateway.ts). The
// monthly limit is in dollars and covers every job; this keeps one busy day
// of questions from using up the month, whichever model Chat is on.

import type pg from 'pg'
import { addDays, todayIn, type IsoDate } from '../../lib/dates.js'
import { zonedInstant } from '../../lib/zonedTime.js'
import type { Settings } from '../settings.js'

/**
 * Tokens Chat may use in a day. A question is often 10,000 to 40,000, most
 * of them read back from the cache, so this is dozens of questions a day.
 */
export const CHAT_DAILY_TOKENS = 600_000

/**
 * Cache reads count a tenth, as they cost a tenth of plain input: the tools
 * and instructions read back on every call would otherwise use the day up.
 */
export const SQL_WEIGHTED_TOKENS =
  'input_tokens + output_tokens + cache_write_tokens + ceil(cache_read_tokens / 10.0)'

export interface ChatAllowance {
  usedTokens: number
  limitTokens: number
  /** The day it starts over, on the owner's clock. */
  resetsOn: IsoDate
}

/** Today's use of the allowance, counted from midnight where the owner lives. */
export async function chatAllowance(
  db: pg.Pool,
  settings: Pick<Settings, 'timeZone'>,
  now: Date,
): Promise<ChatAllowance> {
  const today = todayIn(settings.timeZone, now)
  const { rows } = await db.query<{ used: string }>(
    `SELECT coalesce(sum(${SQL_WEIGHTED_TOKENS}), 0) AS used
     FROM ai_usage WHERE job = 'chat' AND created_at >= $1`,
    [zonedInstant(today, 0, settings.timeZone)],
  )
  return {
    usedTokens: Number(rows[0]!.used),
    limitTokens: CHAT_DAILY_TOKENS,
    resetsOn: addDays(today, 1),
  }
}

/** Whether the day's allowance is used up, and if so, what to tell the owner. */
export function allowanceMessage(allowance: ChatAllowance): string | null {
  if (allowance.usedTokens < allowance.limitTokens) return null
  return "Chat has used today's allowance and can answer again tomorrow. Everything else in Leeway works as usual."
}
