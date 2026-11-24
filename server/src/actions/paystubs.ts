// Actions for paystub import. Reading a file happens at POST
// /api/paystubs/read (http/paystubs.ts), since it takes a file; these save
// and show what the owner confirmed. All are app-only: a paystub is read by a
// third party on the owner's say-so, and its figures stay with the owner.

import { z } from 'zod'
import { MAX_PAYSTUB_BYTES, PAYSTUB_TYPES } from '../domain/paystubs/files.js'
import { deletePaystub, latestPaystub } from '../domain/paystubs/paystubs.js'
import { confirmedDetailSchema } from '../domain/paystubs/confirmed.js'
import { saveDetail } from '../domain/paystubs/detailStore.js'
import { savePaystub, savePaystubSchema } from '../domain/paystubs/save.js'
import { readLatestDetail } from '../domain/paystubs/applied.js'
import { paystubUse } from '../domain/paystubs/use.js'
import { getFinancialProfile } from '../domain/profile/profile.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

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

export const getPaystubUseAction = defineAction({
  name: 'get_paystub_use',
  title: 'Show what Leeway uses from the paystub',
  description:
    'Where the newest paystub stands (none, used, stale when too old to count, or partial when saved for a pension only) and what Leeway uses from it: take-home per paycheck, whether that take-home stands for a paycheck the bank shows (and if not, why: pay the owner entered, a one-off paycheck, no schedule shown, or no matching deposit), and, while used, yearly gross pay, taxes withheld, the effective tax rate and retirement from pay. Totals only.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    const [latest, detail, profile] = await Promise.all([
      latestPaystub(ctx.db),
      readLatestDetail(ctx.db, today),
      getFinancialProfile(ctx.db, settings, today),
    ])
    const { override } = settings.pay
    // Own pay saved beside every job leaves each job, the paystub's included, as found.
    const ownPay = override !== null && !override.besideJobs
    return paystubUse({ latest, detail, profile, ownPay }, today)
  },
})

export const savePaystubAction = defineAction({
  name: 'save_paystub',
  title: 'Save a paystub',
  description:
    'Saves the paystub figures the owner reviewed, in cents. pensionAccountId applies the pension contribution, gross pay, pay frequency and employer share to that pension; newPension ({name, balanceCents}) instead adds a pension holding those figures as a new account, and attachAccountId makes an account Leeway already has (a retirement or investment account) that pension, so it is not counted twice; either happens in the same step, needs a paystub that shows a pension contribution, and only one of the three may be given; setRetirementContribution makes the 401(k), 457 and 403(b) figures the monthly retirement contribution.',
  input: savePaystubSchema,
  scope: 'write',
  surface: 'app',
  run: (ctx, input) => savePaystub(ctx.db, input),
})

// The paystub record saved with the lines becomes latestPaystub, which already
// feeds payroll streams, pay cadence, the profile and the check-in.
export const savePaystubDetailAction = defineAction({
  name: 'save_paystub_detail',
  title: 'Save a paystub in full',
  description:
    'Saves every line of a paystub the owner reviewed in full, in cents: pay (gross and net, each {current, yearToDate}, with hours, hourlyRate and annualSalary), earnings, taxes, preTax, postTax and employer lines. A line the paystub does not show is null. Keeps the paystub record too, its figures worked out from these lines; as the newest paystub it feeds payroll, pay frequency, the profile and check-ins like any saved paystub. Applies nothing to pensions, contributions or budgets.',
  input: z.object({ detail: confirmedDetailSchema }),
  scope: 'write',
  surface: 'app',
  run: (ctx, { detail }) => saveDetail(ctx.db, detail),
})

export const deletePaystubAction = defineAction({
  name: 'delete_paystub',
  title: 'Delete a paystub',
  description:
    'Deletes a saved paystub, with its lines if it was saved in full. A pension or contribution it was saved to keeps its figures.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { id }) => {
    await deletePaystub(ctx.db, id)
    return { deleted: true }
  },
})
