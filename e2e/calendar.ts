// Helpers for the calendar, the weeks ahead and trips. The browser tests have
// no network, so no real calendar can be linked: a linked calendar and what
// it brings are stood in for at the network, by answering the calendar
// actions in the page with names as long as a calendar may give.

import type { Page } from '@playwright/test'

/** Event and trip names longer than a phone has room for. */
export const LONG_EVENT = "Sam and Alex's wedding weekend at the vineyard up past the lake"
export const LONG_TRIP = 'Lisbon, Porto and the whole Algarve coast with the family'

/** A day this many days from today, as the server writes dates. */
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/** What the server notes when some repeating events were left out of a read. */
export const LEFT_OUT =
  'Some repeating events had too many repeats to work out, so they were left out.'

const LINKED = {
  connected: true,
  host: 'p142-caldav.icloud.com.example-calendar-host.org',
  connectedAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(),
  lastError: 'The calendar could not be read just now. Try again later.',
  note: LEFT_OUT,
  eventCount: 1234,
}

function trip(startsIn: number, days: number) {
  return { startsOn: daysFromNow(startsIn), endsOn: daysFromNow(startsIn + days - 1) }
}

const SOON = trip(10, 9)

function forecast() {
  const today = daysFromNow(0)
  const week = (index: number, items: unknown[], billsCents = 0, setAsideCents = 0) => ({
    start: daysFromNow(index * 7),
    end: daysFromNow(index * 7 + 6),
    items,
    billsCents,
    setAsideCents,
  })
  return {
    connected: true,
    today,
    note: LEFT_OUT,
    weeks: [
      week(
        0,
        [
          { type: 'payday', date: daysFromNow(2), amountCents: 412345 },
          {
            type: 'bill',
            date: daysFromNow(3),
            billId: 'b1',
            name: 'Renters insurance with the extra coverage for bikes and cameras',
            amountCents: 123456,
          },
        ],
        123456,
      ),
      week(
        1,
        [
          {
            type: 'event',
            id: 'long-trip',
            date: SOON.startsOn,
            endsOn: SOON.endsOn,
            title: LONG_TRIP,
            kind: 'trip',
            suggestedCents: 1234500,
            basedOn: 12,
          },
        ],
        0,
        1234500,
      ),
      week(2, [
        {
          type: 'event',
          id: 'long-event',
          date: daysFromNow(15),
          endsOn: daysFromNow(15),
          title: LONG_EVENT,
          kind: 'wedding',
          suggestedCents: null,
          basedOn: 0,
        },
      ]),
      week(3, []),
      week(4, []),
      week(5, []),
    ],
  }
}

function trips() {
  return [
    { ...SOON, name: LONG_TRIP, source: 'calendar', totalCents: 1234567 },
    { ...trip(-90, 3), name: null, source: 'spending', totalCents: 45000 },
  ]
}

/** A trip's page, its spending by part and a transaction with a long name. */
function tripDetail() {
  return {
    ...SOON,
    name: LONG_TRIP,
    source: 'calendar',
    totalCents: 1234567,
    days: 9,
    status: 'upcoming',
    spentByPart: { travel: 734567, stay: 300000, food: 150000, activities: 50000 },
    transactions: [
      {
        id: '00000000-0000-4000-8000-0000000000e1',
        accountId: '00000000-0000-4000-8000-0000000000a1',
        accountName: 'Joint everyday checking',
        date: SOON.startsOn,
        name: 'TAP AIR PORTUGAL LISBOA PT international flight booking and seats',
        merchantName: null,
        displayName: 'Tap Air Portugal Lisboa international flight booking and seats',
        amountCents: 734567,
        currency: 'USD',
        pending: false,
        categoryId: null,
        categorySource: null,
        bankCategory: 'TRAVEL_FLIGHTS',
        note: null,
        excluded: false,
        manual: false,
        source: 'bank',
        person: null,
        transfer: null,
      },
    ],
  }
}

/** The path of the trip the stand-ins describe. */
export const SOON_TRIP_PATH = `/trips/${SOON.startsOn}/${SOON.endsOn}`

async function answer(page: Page, action: string, result: unknown) {
  await page.route(`**/api/actions/${action}`, (route) => route.fulfill({ json: { result } }))
}

/**
 * A linked calendar whose last read failed, and whose good read before it
 * left some repeating events out, with the weeks ahead and trips it brings.
 */
export async function pretendCalendar(page: Page) {
  await answer(page, 'calendar_status', LINKED)
  await answer(page, 'get_forecast', forecast())
  await answer(page, 'list_trips', trips())
  await answer(page, 'get_trip', tripDetail())
  await answer(page, 'trip_of_transaction', { ...SOON, name: LONG_TRIP })
}

/**
 * A calendar link that does not answer, as the server says it, without a
 * real lookup: the tests have no network, and a made-up host would still
 * ask the machine's DNS.
 */
export async function calendarNotAnswering(page: Page) {
  await page.route('**/api/actions/connect_calendar', (route) =>
    route.fulfill({
      status: 502,
      json: {
        error: 'calendar_error',
        message: 'The calendar did not answer. Check the link, or try again later.',
      },
    }),
  )
}
