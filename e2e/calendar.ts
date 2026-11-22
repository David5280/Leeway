// Helpers for the calendar and the weeks ahead. The browser tests have
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

const LINKED = {
  connected: true,
  host: 'p142-caldav.icloud.com.example-calendar-host.org',
  connectedAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(),
  lastError: 'The calendar could not be read just now. Try again later.',
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

async function answer(page: Page, action: string, result: unknown) {
  await page.route(`**/api/actions/${action}`, (route) => route.fulfill({ json: { result } }))
}

/** A linked calendar whose last read failed, with the weeks ahead it brings. */
export async function pretendCalendar(page: Page) {
  await answer(page, 'calendar_status', LINKED)
  await answer(page, 'get_forecast', forecast())
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
