// Actions for the linked calendar and the forecast of the weeks ahead. All
// are for the app only: the calendar's address is a secret and its events
// are the owner's own, so none of this reaches an agent.

import { z } from 'zod'
import type { AppContext } from '../context.js'
import { getForecast } from '../domain/calendar/forecast.js'
import {
  calendarStatus,
  connectCalendar,
  disconnectCalendar,
  refreshCalendar,
} from '../domain/calendar/store.js'
import type { CalendarDeps } from '../domain/calendar/reading.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

/** What reading the calendar needs, from the context and the owner's time zone. */
async function calendarDeps(ctx: AppContext): Promise<CalendarDeps> {
  const { settings } = await settingsAndToday(ctx)
  return {
    key: ctx.config.encryptionKey,
    timeZone: settings.timeZone,
    // Asked when each write is made, so a read that took a while is dated when it lands.
    now: () => ctx.now(),
    fetcher: ctx.fetchCalendar,
  }
}

export const calendarStatusAction = defineAction({
  name: 'calendar_status',
  title: 'Calendar link',
  description:
    'Whether a calendar is linked, its host (never its address), when it was last read, why the last read failed if it did, and how many events it holds.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: (ctx) => calendarStatus(ctx.db),
})

export const connectCalendarAction = defineAction({
  name: 'connect_calendar',
  title: 'Link a calendar',
  description:
    'Link a calendar by its private address (an https or webcal link to an .ics file). It is read once at once; a link that does not work is refused and nothing is saved.',
  input: z.object({ url: z.string().trim().min(1).max(2000) }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { url }) => connectCalendar(ctx.db, url, await calendarDeps(ctx)),
})

export const refreshCalendarAction = defineAction({
  name: 'refresh_calendar',
  title: 'Read the calendar again',
  description: 'Read the linked calendar now instead of at the next scheduled read.',
  input: z.object({}),
  scope: 'write',
  surface: 'app',
  run: async (ctx) => refreshCalendar(ctx.db, await calendarDeps(ctx)),
})

export const disconnectCalendarAction = defineAction({
  name: 'disconnect_calendar',
  title: 'Unlink the calendar',
  description: 'Forget the calendar link and its events. Trip budgets already planned stay.',
  input: z.object({}),
  scope: 'write',
  surface: 'app',
  run: (ctx) => disconnectCalendar(ctx.db),
})

export const getForecastAction = defineAction({
  name: 'get_forecast',
  title: 'The weeks ahead',
  description:
    'Six weeks ahead, week by week: paydays, bills due and calendar events likely to cost money, with an amount to set aside where past events show one. Empty with no calendar linked.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => {
    const { settings, today: date } = await settingsAndToday(ctx)
    return getForecast(ctx.db, settings, date)
  },
})
