// The calendar screens the phone layout guard checks (guarded-screens.ts). A
// calendar cannot be linked in the tests, so each is stood in for at the
// network (calendar.ts): the weeks ahead with events left out, and a trip's
// page, ahead with no budget and under way over one.

import type { Screen } from './screen'
import { pretendCalendar, SOON_TRIP_PATH } from './calendar'

export const CALENDAR_SCREENS: Screen[] = [
  {
    name: '/plan/ahead with a calendar linked, noting events left out',
    route: 'planSection',
    path: () => '/plan/ahead',
    before: (page) => pretendCalendar(page),
  },
  {
    name: 'a trip ahead, planning its budget',
    route: 'trip',
    path: () => SOON_TRIP_PATH,
    before: (page) => pretendCalendar(page),
  },
  {
    name: 'a trip under way, over its budget',
    route: 'trip',
    path: () => SOON_TRIP_PATH,
    before: (page) => pretendCalendar(page, { budgeted: true }),
  },
]
