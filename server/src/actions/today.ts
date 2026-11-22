// Today's date where the owner lives, for actions that work from "now".

import type { AppContext } from '../context.js'
import type { IsoDate } from '../lib/dates.js'
import { todayIn } from '../lib/dates.js'
import { goalReading, type GoalReading } from '../domain/goalProgress.js'
import { getSettings, type Settings } from '../domain/settings.js'

export async function settingsAndToday(
  ctx: AppContext,
): Promise<{ settings: Settings; today: IsoDate }> {
  const settings = await getSettings(ctx.db)
  return { settings, today: todayIn(settings.timeZone, ctx.now()) }
}

export async function today(ctx: AppContext): Promise<IsoDate> {
  return (await settingsAndToday(ctx)).today
}

/**
 * Today, the owner's budget periods (which a goal's plan is worked out in)
 * and the settings the emergency fund is measured by.
 */
export async function goalClock(ctx: AppContext): Promise<GoalReading> {
  const { settings, today: date } = await settingsAndToday(ctx)
  return goalReading(settings, date)
}
