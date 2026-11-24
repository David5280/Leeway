// Sinking funds as the Payday screen and an assistant see them: the funds
// added, the costs suggested, and each one's steady share of a budget
// period. That share is the very amount safe to spend holds back
// (setAsides.ts), so the screen and the budget always show one number.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { cadenceOf } from '../../lib/periods.js'
import { periodConfig, type Settings } from '../settings.js'
import type { FundSuggestion } from './detect.js'
import { listFunds, type SinkingFund } from './funds.js'
import { shareOf } from './math.js'
import { findFundSuggestions } from './suggest.js'

export interface SinkingFundsView {
  funds: SinkingFund[]
  /** Each with the share of a budget period it would hold back once added. */
  suggestions: (FundSuggestion & { perPeriodCents: number })[]
  /** What the funds hold back each budget period, in all. */
  totalPerPeriodCents: number
}

/** The funds and suggestions, read fresh. */
export async function readSinkingFunds(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<SinkingFundsView> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const period = cadenceOf(periodConfig(settings))
  const funds = await listFunds(db, today, period)
  const suggestions = await findFundSuggestions(db, today)
  return {
    funds,
    suggestions: suggestions.map((one) => ({ ...one, perPeriodCents: shareOf(one, period) })),
    totalPerPeriodCents: funds.reduce((sum, fund) => sum + fund.perPeriodCents, 0),
  }
}
