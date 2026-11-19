// The AI spending alert as a notification. Unlike the others, it is not a
// condition the notifier's checks find in the data: it is news the moment
// the alert is raised (domain/ai/alerts.ts), which tells the inbox then,
// once. The notifier's next run pushes it like any other.

import type { Db } from '../../db/pool.js'
import { recordCandidates } from './inbox.js'
import { getNotificationSettings } from './settings.js'
import { aiLimitCandidate, type AiLimitNews } from './words.js'

/** Adds a just-raised AI spending alert to the inbox, when the owner turned that kind on. */
export async function notifySpendAlert(db: Db, news: AiLimitNews, now: Date): Promise<void> {
  const choices = await getNotificationSettings(db)
  if (!choices.kinds.ai_limit) return
  await recordCandidates(db, [aiLimitCandidate(news)], now)
}
