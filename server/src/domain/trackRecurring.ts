// Tracking a recurring charge as a bill in one step: everything the bill
// needs is already known from the charges found (recurring.ts), so the owner
// taps once and an assistant calls once, both through trackRecurring. The
// bill stays editable afterwards like any other, and deleting it undoes this.

import { notFound } from '../errors.js'
import type { Db } from '../db/pool.js'
import type { IsoDate } from '../lib/dates.js'
import { billInputSchema, createBill, type Bill } from './bills.js'
import { untracked, type Untracked } from './untrackedRecurring.js'

/** The longest bill name kept, as billInputSchema allows. */
const NAME_LIMIT = 80

/** The bill a series becomes, matched by the key the asker was given. */
export function billFromSeries({ series, shownKey }: Untracked, forAssistant: boolean) {
  return billInputSchema.parse({
    name: series.name.slice(0, NAME_LIMIT),
    kind: series.suggestedKind,
    amountCents: series.typicalAmountCents,
    cadence: series.cadence,
    // The next charge expected is the first due date to track.
    anchorDate: series.nextDate,
    matchPattern: forAssistant ? shownKey : series.key,
    categoryId: series.categoryId,
    autopay: false,
  })
}

/**
 * Tracks a recurring charge as a bill: its name, typical amount, cadence,
 * next date as the due date, category and account. The owner's app passes the
 * series' own key; an assistant passes the key it was given, made from the
 * shown name, and its bill reads shown names. Only money going out is a bill.
 */
export async function trackRecurring(
  db: Db,
  key: string,
  today: IsoDate,
  { forAssistant = false }: { forAssistant?: boolean } = {},
): Promise<Bill> {
  const found = (await untracked(db, today)).find(
    (one) =>
      one.series.direction === 'out' && (forAssistant ? one.shownKey : one.series.key) === key,
  )
  if (!found) throw notFound('Recurring charge')
  return createBill(
    db,
    billFromSeries(found, forAssistant),
    today,
    { byAssistant: forAssistant },
    // A bill whose amount moves (a utility) would alert most cycles, so it never does.
    { accountId: found.series.accountId, amountVaries: found.series.amountVaries },
  )
}
