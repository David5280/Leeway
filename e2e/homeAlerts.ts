// Stand-ins for the browser tests of the home screen's account alerts.

import type { Page } from '@playwright/test'
import type { AccountAlert } from '../server/src/domain/accountAlerts'
import { LONG } from './seed'

/** One alert on an account with the longest name Leeway takes. */
function longAlert(
  fields: Pick<AccountAlert, 'kind' | 'severity' | 'accountId' | 'message'>,
): AccountAlert {
  return {
    accountName: LONG.account,
    amountCents: 124_018,
    count: 1,
    date: null,
    summary: fields.message,
    ...fields,
  }
}

/**
 * Account alerts on the home screen, each with its hide button, for the
 * layout guard: the banner and Heads up both show them. Only the home list is
 * stood in for, so nothing is stored.
 */
export async function fakeLongHomeAlerts(page: Page): Promise<void> {
  const alerts = [
    longAlert({
      kind: 'overdrawn',
      severity: 'urgent',
      accountId: '00000000-0000-4000-8000-0000000000a1',
      message: `${LONG.account} is overdrawn by $1,240.18.`,
    }),
    longAlert({
      kind: 'low_balance',
      severity: 'warning',
      accountId: '00000000-0000-4000-8000-0000000000a2',
      message: `${LONG.account} is down to $20, below your $100 warning.`,
    }),
    // A leak names the merchant, which can run on as long as the bank writes it.
    {
      ...longAlert({
        kind: 'duplicate_charge',
        severity: 'warning',
        accountId: '00000000-0000-4000-8000-0000000000a1',
        message: `${LONG.merchant} charged $1,240.18 twice, on Nov 3 and Nov 4.`,
      }),
      count: 2,
      charge: {
        id: '00000000-0000-4000-8000-0000000000c1',
        merchant: LONG.merchant,
        previousCents: null,
        previousId: null,
      },
    },
  ]
  await page.route('**/api/actions/list_home_alerts', (route) =>
    route.fulfill({ json: { result: { alerts, hidden: 0 } } }),
  )
}
