// A day of net worth history as get_net_worth answers it, owned and owed apart.

import type { NetWorth } from '../api/client'

export function worthPoint(
  date: string,
  netWorthCents: number,
  liabilitiesCents = 0,
): NetWorth['history'][number] {
  return { date, netWorthCents, assetsCents: netWorthCents + liabilitiesCents, liabilitiesCents }
}
