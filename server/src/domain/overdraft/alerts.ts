// The overdraft forecast as account alerts, so a checking account heading
// below zero before payday shows in Heads up and can notify, beside the
// other account alerts. Pure. An account already overdrawn has its own
// alert (accountAlerts.ts), so the forecast warns only about accounts that
// are above zero now: amber, never red, since nothing has gone wrong yet.

import type { AccountAlert, AlertFormat } from '../accountAlerts.js'
import type { AccountForecast } from './forecast.js'

/** The forecast's alert for one account, or null when it stays above zero or is overdrawn already. */
export function forecastAlert(forecast: AccountForecast, format: AlertFormat): AccountAlert | null {
  if (forecast.belowZeroOn === null || forecast.overdrawnNow) return null
  const { money, date } = format
  const when = date(forecast.belowZeroOn)
  const move = forecast.move
    ? ` Moving ${money(forecast.move.amountCents)} from ${forecast.move.fromAccountName} by ${date(forecast.move.byDate)} would cover it.`
    : ''
  return {
    kind: 'overdraft_forecast',
    severity: 'warning',
    accountId: forecast.accountId,
    accountName: forecast.accountName,
    amountCents: forecast.shortCents,
    count: 1,
    date: forecast.belowZeroOn,
    message: `${forecast.accountName} may go ${money(forecast.shortCents)} below zero on ${when}, before payday.${move}`,
    summary: `${forecast.accountName} may go below zero on ${when}, before payday.`,
  }
}

/** Every account's forecast alert, soonest first. */
export function forecastAlerts(forecasts: AccountForecast[], format: AlertFormat): AccountAlert[] {
  return forecasts
    .map((forecast) => forecastAlert(forecast, format))
    .filter((alert) => alert !== null)
    .sort((a, b) => a.date!.localeCompare(b.date!))
}
