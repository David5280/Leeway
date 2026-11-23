// Price rises were first kept under their latest charge's id ("charge:<id>")
// and are now kept under the rise itself (accountAlertSubject, words.ts), so
// another charge posting that day never makes the same rise news again. A
// rise told under the old subject moves to the new one, with its read, push
// and dismissed state and any hide from home, so the change of subject never
// pushes it again or brings it back home. The notifier does this first on
// every run, the first of them when the server starts. Once every rise told
// under the old subject is past its news window (RISE_NEWS_DAYS), nothing is
// left to move and this can go.

import type { Db } from '../../db/pool.js'
import type { AccountAlert } from '../accountAlerts.js'
import { moveHides } from './homeAlerts.js'
import { moveSubjects } from './inbox.js'
import { accountAlertSubject } from './words.js'

/** The subject a price rise was kept under before: its latest charge's id. */
export function oldRiseSubject(alert: Pick<AccountAlert, 'charge'>): string {
  return `charge:${alert.charge?.id}`
}

/** Moves the notifications and hides of current price rises from their old subject to their own. */
export async function followRiseSubjects(db: Db, alerts: AccountAlert[]): Promise<void> {
  const moves = alerts
    .filter((alert) => alert.kind === 'price_rise' && alert.charge)
    .map((alert) => ({ from: oldRiseSubject(alert), to: accountAlertSubject(alert) }))
  if (moves.length === 0) return
  await moveSubjects(db, 'price_rise', moves)
  await moveHides(db, 'price_rise', moves)
}
