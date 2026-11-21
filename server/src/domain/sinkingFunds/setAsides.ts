// Sinking funds as budget set-asides: each fund's steady share of the
// current budget period is held back from the budget's room, the same path
// a goal set aside takes (setAsides in budgetReport.ts), so safe to spend
// and the playbook count it once.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { cadenceOf } from '../../lib/periods.js'
import type { SetAside } from '../budget.js'
import { periodConfig, type Settings } from '../settings.js'
import { listFunds } from './funds.js'

/** The color a sinking fund is drawn in beside goals: a calm teal. */
export const FUND_COLOR = '#2BB3A3'

/** Each sinking fund's share of the current budget period. */
export async function fundSetAsides(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<SetAside[]> {
  const funds = await listFunds(db, today, cadenceOf(periodConfig(settings)))
  return funds.map((fund) => ({
    goalId: fund.id,
    name: fund.name,
    color: FUND_COLOR,
    amountCents: fund.perPeriodCents,
    kind: 'sinking_fund' as const,
  }))
}
