// Actions for trips: the list, one trip's page and a transaction's trip. All
// are for the app only: trips are named for the owner's calendar events,
// which are their own, so none of this reaches an agent.

import { z } from 'zod'
import { getTrip, listTrips, tripOfTransaction } from '../domain/trips/trips.js'
import { isoDateSchema } from '../lib/schemas.js'
import { defineAction } from './action.js'
import { today } from './today.js'

export const listTripsAction = defineAction({
  name: 'list_trips',
  title: 'Trips',
  description:
    'Recent and coming trips, from the calendar and runs of travel spending, each with its total.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => listTrips(ctx.db, await today(ctx)),
})

export const getTripAction = defineAction({
  name: 'get_trip',
  title: 'A trip',
  description: "One trip's transactions and total, by part.",
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
