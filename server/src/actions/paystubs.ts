// Actions for paystub import. Reading a file happens at POST
// /api/paystubs/read (http/paystubs.ts), since it takes a file; these save
// and show what the owner confirmed. All are app-only: a paystub is read by a
// third party on the owner's say-so, and its figures stay with the owner.

import { z } from 'zod'
import { MAX_PAYSTUB_BYTES, PAYSTUB_TYPES } from '../domain/paystubs/files.js'
import {
  deletePaystub,
  latestPaystub,
  savePaystub,
  savePaystubSchema,
} from '../domain/paystubs/paystubs.js'
import { defineAction } from './action.js'

export const getPaystubAction = defineAction({
  name: 'get_paystub',
  title: 'Show paystub import',
  description:
    'Whether paystub import is available (it needs ANTHROPIC_API_KEY), who reads the file, the file types and sizes it takes, and the newest paystub saved.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => ({
    available: ctx.paystubs !== null,
    readerName: ctx.paystubs?.readerName ?? null,
    types: PAYSTUB_TYPES,
    maxBytes: MAX_PAYSTUB_BYTES,
    latest: await latestPaystub(ctx.db),
  }),
})

export const savePaystubAction = defineAction({
  name: 'save_paystub',
  title: 'Save a paystub',
  description:
    'Saves the paystub figures the owner reviewed, in cents. pensionAccountId applies the pension contribution, gross pay, pay frequency and employer share to that pension; setRetirementContribution makes the 401(k), 457 and 403(b) figures the monthly retirement contribution.',
  input: savePaystubSchema,
  scope: 'write',
  surface: 'app',
  run: (ctx, input) => savePaystub(ctx.db, input),
})

export const deletePaystubAction = defineAction({
  name: 'delete_paystub',
  title: 'Delete a paystub',
  description:
    'Deletes a saved paystub. A pension or contribution it was saved to keeps its figures.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { id }) => {
    await deletePaystub(ctx.db, id)
    return { deleted: true }
  },
})
