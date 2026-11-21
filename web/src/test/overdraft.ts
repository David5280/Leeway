// The overdraft forecast as get_overdraft_forecast returns it, walked forward
// with the server's own math from made-up accounts and bills.

import {
  forecastAccounts,
  type ForecastInput,
  type SpareAccount,
} from '../../../server/src/domain/overdraft/forecast'
import type { OverdraftForecast } from '../api/client'

export const FORECAST_TODAY = '2026-11-17'
export const FORECAST_PAYDAY = '2026-11-27'

/** A checking account with $1,000 in it, nothing due and no usual spending. */
export function checkingInput(fields: Partial<ForecastInput> = {}): ForecastInput {
  return {
    accountId: 'acct-everyday',
    accountName: 'Everyday',
    startCents: 100_000,
    dailySpendCents: 0,
    bills: [],
    ...fields,
  }
}

export const RENT = { name: 'Rent', dueDate: '2026-11-20', amountCents: 120_000 }

export const RAINY_DAY: SpareAccount = {
  accountId: 'acct-savings',
  accountName: 'Rainy day',
  spareCents: 300_000,
}

/** get_overdraft_forecast's answer for these accounts. */
export function forecastOf(
  inputs: ForecastInput[] = [checkingInput()],
  savings: SpareAccount[] = [RAINY_DAY],
): OverdraftForecast {
  return {
    payday: FORECAST_PAYDAY,
    paydayEstimate: false,
    accounts: forecastAccounts(inputs, savings, FORECAST_TODAY, FORECAST_PAYDAY),
  }
}
