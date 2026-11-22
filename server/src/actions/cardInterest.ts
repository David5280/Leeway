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
    "What each counted credit card carrying a balance costs in interest a month, estimated as balance times APR over 12, and the total a month. A card with no APR yet has monthlyInterestCents null and is counted in missingApr, left out of the total; the owner can add its APR with update_account (aprPercent) from the card's statement. Amounts are in cents. Cards are named as the app names them, with no account number.",
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => cardInterestTotal(await listAccounts(ctx.db)),
})
