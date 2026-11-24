// Sinking funds as list_sinking_funds returns them, with shares worked out
// by the server's own math, for a monthly budget. Every name and amount is made up.

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
    shortCents: 0,
    ...fields,
  }
}

export function suggestion(
  fields: Partial<Suggestion> & { name: string; amountCents: number },
): Suggestion {
  const cadence = fields.cadence ?? 'year'
  return {
    key: '0f1e2d3c-4b5a-4968-8776-655443322110',
    billId: null,
    cadence,
    dueDate: '2026-12-15',
    basis: 'renewal',
    perPeriodCents: shareOf({ amountCents: fields.amountCents, cadence }, 'month'),
    ...fields,
  }
}

/** The view for these funds and suggestions. */
export function fundsView(funds: Fund[] = [], suggestions: Suggestion[] = []): SinkingFundsView {
  return {
    funds,
    suggestions,
    totalPerPeriodCents: funds.reduce((sum, one) => sum + one.perPeriodCents, 0),
  }
}
