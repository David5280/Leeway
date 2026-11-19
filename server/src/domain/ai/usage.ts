// The AI usage record: one row per paid call, counts and costs only.

import type { AiJob } from '../../ai/jobs.js'
import type { TokenUsage } from '../../ai/provider.js'
import type { Db } from '../../db/pool.js'
import type { AiMonth } from './month.js'

export interface UsageRecord {
  job: AiJob
  model: string
  usage: TokenUsage
  costMicros: number
  /** The worst case recorded for a call that failed and may have been billed. */
  estimated?: boolean
}

/** What one job spent in a month. */
export interface JobSpend {
  calls: number
  costMicros: number
}

export interface MonthSpend {
  totalMicros: number
  calls: number
  byJob: Partial<Record<AiJob, JobSpend>>
}

export async function recordUsage(db: Db, record: UsageRecord, at: Date): Promise<void> {
  const { usage } = record
  await db.query(
    `INSERT INTO ai_usage (job, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, cost_micros, estimated, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      record.job,
      record.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
      record.costMicros,
      record.estimated ?? false,
      at,
    ],
  )
}

/** Calls and cost in the month, in all and by job. */
export async function monthSpend(db: Db, month: AiMonth): Promise<MonthSpend> {
  const { rows } = await db.query<{ job: AiJob; calls: number; costMicros: number }>(
    `SELECT job, count(*)::int AS calls, sum(cost_micros)::float8 AS "costMicros"
     FROM ai_usage WHERE created_at >= $1 AND created_at < $2
     GROUP BY job ORDER BY job`,
    [month.startsAt, month.endsAt],
  )
  const spend: MonthSpend = { totalMicros: 0, calls: 0, byJob: {} }
  for (const { job, calls, costMicros } of rows) {
    spend.totalMicros += costMicros
    spend.calls += calls
    spend.byJob[job] = { calls, costMicros }
  }
  return spend
}
