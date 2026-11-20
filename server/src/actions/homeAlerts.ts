// The account alerts on the home screen, and hiding one there. Both app only:
// hiding is about what the owner's own home screen shows, while assistants
// read every alert through list_alerts, hidden or not, so none is kept from
// them and none of them can put one out of the owner's sight.

import { z } from 'zod'
import { ALERT_KINDS } from '../domain/accountAlerts.js'
import { listAlerts } from '../domain/alerts.js'
import { hideHomeAlert, listHomeAlerts } from '../domain/notifications/homeAlerts.js'
import type { AppContext } from '../context.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

/** Every current alert, for all accounts, as the home rules need them. */
async function currentAlerts(ctx: AppContext) {
  const { settings, today } = await settingsAndToday(ctx)
  return listAlerts(ctx.db, settings, today)
}

export const listHomeAlertsAction = defineAction({
  name: 'list_home_alerts',
  title: 'Home screen alerts',
  description:
    'The account alerts for the home screen: every current one, less those hidden there or dismissed in the inbox lately.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => listHomeAlerts(ctx.db, await currentAlerts(ctx), ctx.now()),
})

export const hideHomeAlertAction = defineAction({
  name: 'hide_home_alert',
  title: 'Hide an alert from home',
  description:
    'Hide an account alert from the home screen for a day, or until it clears. The inbox is left as it was.',
  input: z.object({ kind: z.enum(ALERT_KINDS), accountId: z.uuid() }).strict(),
  scope: 'write',
  surface: 'app',
  run: async (ctx, target) => {
    await hideHomeAlert(ctx.db, await currentAlerts(ctx), target, ctx.now())
    return { hidden: true }
  },
})
