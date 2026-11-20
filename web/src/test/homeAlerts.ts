// Fakes for the home screen's account alerts: list_home_alerts and
// hide_home_alert as the server answers them, keeping what was hidden.

import type { AccountAlert } from '../api/client'
import type { Handlers } from './fake'

/** An alert, or a request naming one, as the fake server reads it. */
type Target = { kind?: unknown; accountId?: unknown }

/**
 * The home alert actions over these alerts. `hide` takes one off the home
 * list as the server would, for tests that put an alert away another way
 * (like dismissing it in the inbox).
 */
export function homeAlertHandlers(alerts: AccountAlert[]) {
  const hidden = new Set<string>()
  /** One alert per kind and account, as the server keys a hide. */
  const keyOf = ({ kind, accountId }: Target) => `${String(kind)}:${String(accountId)}`
  const hide = (target: Target) => hidden.add(keyOf(target))
  const handlers: Handlers = {
    list_home_alerts: () => alerts.filter((alert) => !hidden.has(keyOf(alert))),
    hide_home_alert: (target) => (hide(target), { hidden: true }),
  }
  return { handlers, hide }
}
