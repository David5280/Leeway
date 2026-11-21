// Actions for what the owner owns and owes beyond the bank link: a home, a
// car, anything else of value, and loans, entered by hand. Removing one is
// delete_account, as for any manual account.

import { z } from 'zod'
import { withTransaction } from '../db/pool.js'
import {
  addHandEntered,
  handEnteredInputSchema,
  handEnteredPatchSchema,
  listOwnedAndOwed,
  updateHandEntered,
} from '../domain/owned.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

const OWNED_EXPLAINED =
  "Amounts are in cents. Each item: id, name, kind (home, vehicle, other or loan; older hand-kept accounts can read cash, investment or card), side (owned or owed), amountCents (what it is worth, or for a loan what is owed), aprPercent and monthlyPaymentCents for a loan, and for something owned the loan against it (loanId, loanName) and equityCents (its value less that loan). updatedOn is the day its amount was last entered, since nothing keeps it current but the owner. inNetWorth is false for a hidden one. enteredByYou is always true: say these figures are the owner's own, not the bank's. Each is a manual account: it counts in get_net_worth, and a loan with a rate and payment counts in plan_debt_payoff."

export const listOwnedAndOwedAction = defineAction({
  name: 'list_owned_and_owed',
  title: 'List what is owned and owed by hand',
  description: `Everything owned and owed that the owner entered by hand, beyond the bank link: owned and owed items, with ownedCents and owedCents (the ones counted in net worth, added up). Pensions are left out; see project_retirement. ${OWNED_EXPLAINED}`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings } = await settingsAndToday(ctx)
    return listOwnedAndOwed(ctx.db, settings.timeZone)
  },
})

export const addOwnedOrOwedAction = defineAction({
  name: 'add_owned_or_owed',
  title: 'Add something owned or owed',
  description: `Adds a home, a vehicle, anything else of value (kind other) or a loan by hand, so it counts in net worth. amountCents is what it is worth, or for a loan what is still owed. A loan can carry aprPercent and monthlyPaymentCents; something owned can name the loan against it (loanId). Returns the item. ${OWNED_EXPLAINED}`,
  input: handEnteredInputSchema,
  scope: 'write',
  surface: 'all',
  run: async (ctx, input) => {
    const { settings } = await settingsAndToday(ctx)
    return withTransaction(ctx.db, (db) => addHandEntered(db, input, settings))
  },
})

export const updateOwnedOrOwedAction = defineAction({
  name: 'update_owned_or_owed',
  title: 'Change something owned or owed',
  description: `Changes a thing entered by hand: its name, amountCents, a loan's aprPercent and monthlyPaymentCents, or the loan against something owned (loanId, null for none). Only the fields given change; bank accounts are refused. Returns the item. ${OWNED_EXPLAINED}`,
  input: handEnteredPatchSchema.extend({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id, ...patch }) => {
    const { settings } = await settingsAndToday(ctx)
    return withTransaction(ctx.db, (db) => updateHandEntered(db, id, patch, settings.timeZone))
  },
})
