// Fakes for the home screen's account alerts: list_home_alerts and
// hide_home_alert as the server answers them, keeping what was hidden.

import type { AccountAlert } from '../api/client'
import type { Handlers } from './fake'

/** The home list as list_home_alerts answers: these alerts shown, `hidden` put away. */
export const homeList = (alerts: AccountAlert[], hidden = 0) => ({ alerts, hidden })

/** An alert, or a request naming one, as the fake server reads it. */
type Target = {
  kind?: unknown
  accountId?: unknown
  billId?: unknown
  bill?: { id: string }
  chargeId?: unknown
  charge?: { id: string }
}

/**
 * The home alert actions over these alerts. `hide` takes one off the home
 * list as the server would, for tests that put an alert away another way
 * (like dismissing it in the inbox).
 */
export function homeAlertHandlers(alerts: AccountAlert[]) {
  const hidden = new Set<string>()
  /** One alert per kind and account, per bill for a bill's change and per charge for a leak, as the server keys a hide. */
  const keyOf = ({ kind, accountId, billId, bill, chargeId, charge }: Target) =>
    [kind, accountId, billId ?? bill?.id ?? '', chargeId ?? charge?.id ?? ''].map(String).join(':')
  const hide = (target: Target) => hidden.add(keyOf(target))
  const handlers: Handlers = {
    list_home_alerts: () => {
      const shown = alerts.filter((alert) => !hidden.has(keyOf(alert)))
      return homeList(shown, alerts.length - shown.length)
    },
    hide_home_alert: (target) => (hide(target), { hidden: true }),
  }
  return { handlers, hide }
}
