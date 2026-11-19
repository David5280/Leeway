// Models the provider said it does not have: retired, mistyped, or not on
// this account. Kept so Settings can say which job's model to change, until a
// call with that model works again.

import type { Db } from '../../db/pool.js'

export async function markUnavailable(db: Db, model: string, at: Date): Promise<void> {
  await db.query(
    `INSERT INTO ai_unavailable_models (model, seen_at) VALUES ($1, $2)
     ON CONFLICT (model) DO UPDATE SET seen_at = $2`,
    [model, at],
  )
}

export async function markAvailable(db: Db, model: string): Promise<void> {
  await db.query('DELETE FROM ai_unavailable_models WHERE model = $1', [model])
}

export async function unavailableModels(db: Db): Promise<Set<string>> {
  const { rows } = await db.query<{ model: string }>('SELECT model FROM ai_unavailable_models')
  return new Set(rows.map((row) => row.model))
}
