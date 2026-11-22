// The account alerts on the home screen, and hiding one there. Both app only:
// hiding is about what the owner's own home screen shows, while assistants
// read every alert through list_alerts, hidden or not, so none is kept from
// them and none of them can put one out of the owner's sight.

import { z } from 'zod'
import { ALERT_KINDS, LEAK_KINDS } from '../domain/accountAlerts.js'
import { currentAlerts, hideHomeAlert, listHomeAlerts } from '../domain/notifications/homeAlerts.js'
import { getNotificationSettings, kindsOn } from '../domain/notifications/settings.js'
import { defineAction } from './action.js'

export const listHomeAlertsAction = defineAction({
  name: 'list_home_alerts',
  title: 'Home screen alerts',
  description:
    'The account alerts for the home screen: every current one, less those hidden there or dismissed in the inbox lately, and how many are put away.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => {
    const now = ctx.now()
    const on = kindsOn(await getNotificationSettings(ctx.db))
    return listHomeAlerts(ctx.db, await currentAlerts(ctx.db, now), on, now)
  },
})

export const hideHomeAlertAction = defineAction({
  name: 'hide_home_alert',
  title: 'Hide an alert from home',
  description:
    "Hide an account alert from the home screen: a condition for a day while it holds, a fee or a leak (give a leak's chargeId) for good. The inbox is left as it was. A bill's change (give its billId) is accepted instead: the charge's amount becomes the bill's usual one, which clears it.",
  input: z
    .object({
      kind: z.enum(ALERT_KINDS),
      accountId: z.uuid(),
      billId: z.uuid().optional(),
      chargeId: z.uuid().optional(),
    })
    .strict(),
  scope: 'write',
  surface: 'app',
  run: async (ctx, target) => {
    // Only the account alerts are read, bills only for a bill's change and
    // charges only for a leak, so a problem with one never stands in the way
    // of another hide.
    const now = ctx.now()
    const only = { bills: target.kind === 'bill_change', leaks: LEAK_KINDS.includes(target.kind) }
    await hideHomeAlert(ctx.db, await currentAlerts(ctx.db, now, only), target, now)
    return { hidden: true }
  },
})
