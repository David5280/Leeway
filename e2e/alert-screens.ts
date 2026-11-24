// The alert screens the phone layout guard checks (guarded-screens.ts), with
// the server's answers stood in for, so nothing is stored or sent: account
// alerts on the home screen with their hide buttons (homeAlerts.ts), a long
// inbox, and push turned on in Settings (notifications.ts).

import type { RouteName } from '../web/src/routes'
import type { Screen } from './screen'
import { fakeLongHomeAlerts } from './homeAlerts'
import { fakeLongInbox, pushOnThisDevice, seePushOn } from './notifications'

/** A screen at a fixed address, named for what it shows there. */
const screen = (
  route: RouteName,
  path: string,
  name: string,
  more: Pick<Screen, 'before' | 'then'>,
): Screen => ({ name: `${path} ${name}`, route, path: () => path, ...more })

export const ALERT_SCREENS: Screen[] = [
  screen('overview', '/', 'with long account alerts to hide', { before: fakeLongHomeAlerts }),
  screen('inbox', '/inbox', 'with long alerts, read, unread and cleared', {
    before: fakeLongInbox,
  }),
  screen('settings', '/settings/notifications', 'with push on this device', {
    // A fake browser and push service: no test reaches a real one.
    before: pushOnThisDevice,
    then: seePushOn,
  }),
]
