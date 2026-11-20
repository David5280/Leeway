// The account alerts on the home screen, and hiding one there. Both app only:
// hiding is about what the owner's own home screen shows, while assistants
// read every alert through list_alerts, hidden or not, so none is kept from
// them and none of them can put one out of the owner's sight.

import { z } from 'zod'
import { ALERT_KINDS } from '../domain/accountAlerts.js'
import { currentAlerts, hideHomeAlert, listHomeAlerts } from '../domain/notifications/homeAlerts.js'
import { refreshInbox } from '../domain/notifications/notifier.js'
import { defineAction } from './action.js'

export const listHomeAlertsAction = defineAction({
  name: 'list_home_alerts',
  title: 'Home screen alerts',
  description:
    'The account alerts for the home screen: every current one, less those hidden there or dismissed in the inbox lately, and how many are put away.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => listHomeAlerts(ctx.db, await currentAlerts(ctx.db, ctx.now()), ctx.now()),
})

export const hideHomeAlertAction = defineAction({
  name: 'hide_home_alert',
  title: 'Hide an alert from home',
  description:
    'Hide an account alert from the home screen: a condition for a day while it holds, a fee for good. The inbox is left as it was.',
  input: z.object({ kind: z.enum(ALERT_KINDS), accountId: z.uuid() }).strict(),
  scope: 'write',
  surface: 'app',
  run: async (ctx, target) => {
    // The inbox first, so this run of the alert is on record before its hide.
    await refreshInbox(ctx)
    await hideHomeAlert(ctx.db, await currentAlerts(ctx.db, ctx.now()), target, ctx.now())
    return { hidden: true }
  },
})
