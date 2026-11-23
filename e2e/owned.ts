// Helpers for things entered by hand on the Net worth section: a cabin and the
// loan against it, added through the actions, and removed again after.

import type { Page } from '@playwright/test'
import { action } from './manual'

export const CABIN = 'Cabin'
export const CABIN_LOAN = 'Cabin loan'

interface Item {
  id: string
  name: string
}

/** Adds the loan, then the cabin with the loan against it, as the owner would. */
export async function addCabin(page: Page): Promise<void> {
  const loan = await action<Item>(page, 'add_owned_or_owed', {
    kind: 'loan',
    name: CABIN_LOAN,
    amountCents: 9_000_000,
    aprPercent: 5.5,
    monthlyPaymentCents: 60_000,
  })
  await action(page, 'add_owned_or_owed', {
    kind: 'home',
    name: CABIN,
    amountCents: 15_000_000,
    loanId: loan.id,
  })
}

/** Deletes whatever the specs added by hand, however far they got. */
export async function removeCabin(page: Page): Promise<void> {
  const list = await action<{ owned: Item[]; owed: Item[] }>(page, 'list_owned_and_owed')
  for (const item of [...list.owned, ...list.owed]) {
    if (item.name === CABIN || item.name === CABIN_LOAN) {
      await action(page, 'delete_account', { id: item.id })
    }
  }
}
