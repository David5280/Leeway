// The drill-down for one checking account's forecast to payday: what it holds
// now, less the bills paid from it and its usual spending, and when it is
// lowest. Pure, like every drill in lib/drills.

import type { AccountForecast } from '../../api/client'
import type { DrillDown } from '../drill'

/** One account walked forward to payday. */
export function forecastDrill(
  forecast: AccountForecast,
  payday: string,
  date: (iso: string) => string,
  money: (cents: number) => string,
): DrillDown {
  const short = forecast.belowZeroOn !== null
  // Red only for an account already below zero; a forecast is a warning.
  const tone = forecast.overdrawnNow ? 'problem' : 'warn'
  return {
    title: forecast.accountName,
    subtitle: `Until payday, ${date(payday)}`,
    figure: short ? { cents: forecast.shortCents, tone } : { cents: forecast.lowestCents },
    math: {
      terms: [
        { label: 'In the account now', value: { cents: forecast.startCents } },
        { label: 'bills paid from it', value: { cents: forecast.billsCents }, op: 'minus' },
        {
          label: `usual spending, ${money(forecast.dailySpendCents)} a day`,
          value: { cents: forecast.spendingCents },
          op: 'minus',
        },
      ],
      result: {
        label: 'On payday, before the paycheck',
        value: { cents: forecast.paydayCents, ...(forecast.paydayCents < 0 && { tone }) },
      },
      note: `At its lowest, ${money(forecast.lowestCents)} on ${date(forecast.lowestDate)}. Usual spending is what went out over the last eight weeks, bills and moves between your accounts aside.`,
    },
    items:
      forecast.bills.length > 0
        ? {
            title: 'Bills before payday',
            rows: forecast.bills.map((bill) => ({
              key: `${bill.name}-${bill.dueDate}`,
              label: bill.name,
              detail: `Due ${date(bill.dueDate)}`,
              value: { cents: bill.amountCents },
              to: '/plan/bills',
            })),
          }
        : undefined,
  }
}
