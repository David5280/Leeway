// get_card_interest: what credit card balances cost in interest a month.
// It only reads.

import { z } from 'zod'
import { listAccounts } from '../domain/accounts.js'
import { cardInterestTotal } from '../domain/cardInterest.js'
import { defineAction } from './action.js'

export const getCardInterestAction = defineAction({
  name: 'get_card_interest',
  title: 'Get credit card interest',
  description:
    "What each counted credit card carrying a balance would cost in interest a month, estimated as balance times APR over 12, and the total a month. Interest applies only to a balance carried past the due date: paying the full statement balance by then costs none, so present these as what carrying the balance costs. Cards are those of kind credit_card. A card with no APR yet has monthlyInterestCents null and is counted in missingApr, left out of the total; the owner can add its APR with update_account (aprPercent) from the card's statement. Amounts are in cents. Cards are named as the app names them, with no account number.",
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => cardInterestTotal(await listAccounts(ctx.db)),
})
