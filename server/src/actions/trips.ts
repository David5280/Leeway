// Actions for trips: the list, one trip's page, a transaction's trip, and
// planning a trip's budget. All are for the app only: trips are named for
// the owner's calendar events, which are their own, so none of this reaches
// an agent.

import { z } from 'zod'
import { tripBudgetInputSchema, tripBudgetUpdateSchema } from '../domain/trips/budget.js'
import { createTripBudget, updateTripBudget } from '../domain/trips/planBudget.js'
import { getTrip, listTrips, tripOfTransaction } from '../domain/trips/trips.js'
import { isoDateSchema } from '../lib/schemas.js'
import { defineAction } from './action.js'
import { goalClock, today } from './today.js'

export const listTripsAction = defineAction({
  name: 'list_trips',
  title: 'Trips',
  description:
    'Recent and coming trips, from the calendar and runs of travel spending, each with its total and its budget goal, if any.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => listTrips(ctx.db, await today(ctx)),
})

export const getTripAction = defineAction({
  name: 'get_trip',
  title: 'A trip',
  description: "One trip's transactions and total, by part, against its budget when it has one.",
  input: z.object({ startsOn: isoDateSchema, endsOn: isoDateSchema }),
  scope: 'read',
  surface: 'app',
  run: async (ctx, { startsOn, endsOn }) => getTrip(ctx.db, startsOn, endsOn, await today(ctx)),
})

export const tripOfTransactionAction = defineAction({
  name: 'trip_of_transaction',
  title: "A transaction's trip",
  description: 'The trip a transaction is part of, or null.',
  input: z.object({ id: z.uuid() }),
  scope: 'read',
  surface: 'app',
  run: async (ctx, { id }) => tripOfTransaction(ctx.db, id, await today(ctx)),
})

export const createTripBudgetAction = defineAction({
  name: 'create_trip_budget',
  title: 'Plan a trip budget',
  description:
    'Plan what a trip will cost: getting there, a place to stay, food per day and things to do. Saves one purchase goal for the total, due the day the trip starts.',
  input: tripBudgetInputSchema,
  scope: 'write',
  surface: 'app',
  run: async (ctx, input) => createTripBudget(ctx.db, input, await goalClock(ctx)),
})

export const updateTripBudgetAction = defineAction({
  name: 'update_trip_budget',
  title: 'Change a trip budget',
  description:
    "Change a trip budget's name, days or parts before the trip starts. Its goal takes the new total and start day.",
  input: tripBudgetUpdateSchema,
  scope: 'write',
  surface: 'app',
  run: async (ctx, input) => updateTripBudget(ctx.db, input, await goalClock(ctx)),
})
