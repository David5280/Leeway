// Sinking funds as list_sinking_funds returns them, with shares worked out
// by the server's own math. Every name and amount is made up.

import { shareOf } from '../../../server/src/domain/sinkingFunds/math'
import type { SinkingFundsView } from '../api/client'

type Fund = SinkingFundsView['funds'][number]
type Suggestion = SinkingFundsView['suggestions'][number]

export function fund(fields: Partial<Fund> & { name: string; amountCents: number }): Fund {
  const cadence = fields.cadence ?? 'year'
  return {
    id: `fund-${fields.name.toLowerCase()}`,
    billId: null,
    cadence,
    nextDueDate: '2027-03-01',
    perPeriodCents: shareOf({ amountCents: fields.amountCents, cadence }, 'month'),
    shareCents: shareOf({ amountCents: fields.amountCents, cadence }, 'biweek'),
    ...fields,
  }
}

export function suggestion(
  fields: Partial<Suggestion> & { name: string; amountCents: number },
): Suggestion {
  const cadence = fields.cadence ?? 'year'
  return {
    key: `name:${fields.name.toLowerCase()}`,
    billId: null,
    cadence,
    dueDate: '2026-12-15',
    basis: 'renewal',
    shareCents: shareOf({ amountCents: fields.amountCents, cadence }, 'biweek'),
    ...fields,
  }
}

/** The view for these funds and suggestions, shared by paycheck every two weeks. */
export function fundsView(funds: Fund[] = [], suggestions: Suggestion[] = []): SinkingFundsView {
  return {
    shareOf: 'paycheck',
    cadence: 'biweek',
    funds,
    suggestions,
    totalShareCents: funds.reduce((sum, one) => sum + one.shareCents, 0),
  }
}
