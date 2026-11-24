// Sinking funds as the Payday screen and an assistant see them: the funds
// added, the costs suggested, and each one's steady share of a paycheck.
// The paycheck is the one paydayFrom gives everywhere (pay/payday.ts), so
// "each paycheck" here is the same paycheck as the cash flow's; while no pay
// is known, the share is of a budget period instead.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { cadenceOf, type Cadence } from '../../lib/periods.js'
import { paydayFrom } from '../pay/payday.js'
import { readCurrentPay } from '../pay/source.js'
import { periodConfig, type Settings } from '../settings.js'
import type { FundSuggestion } from './detect.js'
import { listFunds, type SinkingFund } from './funds.js'
import { shareOf } from './math.js'
import { findFundSuggestions } from './suggest.js'

/** A share of each paycheck, or of each budget period while no pay is known. */
export type ShareOf = 'paycheck' | 'period'

export interface SinkingFundsView {
  shareOf: ShareOf
  /** How often that paycheck (or budget period) comes. */
  cadence: Cadence
  funds: (SinkingFund & { shareCents: number })[]
  suggestions: (FundSuggestion & { shareCents: number })[]
  /** What the funds come to each paycheck (or period), in all. */
  totalShareCents: number
}

/** The funds and suggestions, read fresh. */
export async function readSinkingFunds(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<SinkingFundsView> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const payday = paydayFrom(await readCurrentPay(db, settings, today), settings, today)
  const periodCadence = cadenceOf(periodConfig(settings))
  const cadence = payday.cadence ?? periodCadence
  const funds = await listFunds(db, today, periodCadence)
  const suggestions = await findFundSuggestions(db, today)
  const withShare = <T extends FundSuggestion | SinkingFund>(fund: T) => ({
    ...fund,
    shareCents: shareOf(fund, cadence),
  })
  const shared = funds.map(withShare)
  return {
    shareOf: payday.cadence ? 'paycheck' : 'period',
    cadence,
    funds: shared,
    suggestions: suggestions.map(withShare),
    totalShareCents: shared.reduce((sum, fund) => sum + fund.shareCents, 0),
  }
}
