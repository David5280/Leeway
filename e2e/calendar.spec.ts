// The calendar stays out of the way until linked, a link is checked before
// anything is saved, the weeks ahead show what is coming and open a trip,
// and a trip's page plans its budget. No real calendar can be reached from
// the tests, so a linked one, and a calendar that does not answer, are stood
// in for (calendar.ts).

import { expect, test } from '@playwright/test'
import {
  calendarNotAnswering,
  LEFT_OUT,
  LONG_EVENT,
  LONG_TRIP,
  pretendCalendar,
  SOON_TRIP,
  SOON_TRIP_PATH,
} from './calendar'
import { action } from './seed'

test('with no calendar linked, it is one quiet entry in Settings and nowhere else', async ({
  page,
}) => {
  await page.goto('/')
  // Ready first: the hero and every widget loaded, so an absence below means something.
  await expect(page.getByRole('region', { name: 'Your leeway' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByText(/calendar/i)).toHaveCount(0)
  // Home's own Coming up before payday lists bills; nothing else is coming up.
  await expect(
    page.getByText(/coming up/i).filter({ hasNotText: /^Coming up before payday$/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('link', { name: /calendar/i })).toHaveCount(0)
  // Payday's next two weeks list paydays and bills, and say nothing of a calendar.
  const forecast = page.waitForResponse('**/api/actions/get_forecast')
  await page.goto('/payday')
  await forecast
  const twoWeeks = page.getByRole('region', { name: 'Next two weeks' })
  await expect(twoWeeks).toBeVisible()
  await expect(twoWeeks.getByText(/calendar/i)).toHaveCount(0)
  await page.goto('/settings/calendar')
  await expect(page.getByRole('button', { name: 'Connect a calendar', exact: true })).toBeDisabled()
})

test('a calendar link is checked before anything is saved', async ({ page }) => {
  await page.goto('/settings/calendar')
  const link = page.getByRole('textbox', { name: 'Calendar link' })
  await link.fill('http://calendar.example.com/basic.ics')
  await page.getByRole('button', { name: 'Connect a calendar', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(/secure calendar link/)
  // A calendar that does not answer is said plainly, and the address is not repeated back.
  await calendarNotAnswering(page)
  await link.fill('https://calendar.example.com/private-abc123/basic.ics')
  await page.getByRole('button', { name: 'Connect a calendar', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(/did not answer/)
  await expect(page.getByText('private-abc123')).toHaveCount(0)
  expect(await action(page.request, 'calendar_status')).toMatchObject({ connected: false })
})

test('the weeks ahead show paydays, bills and events, and open a trip', async ({ page }) => {
  await pretendCalendar(page)
  await page.goto('/payday/six-weeks')
  await expect(page.getByRole('heading', { level: 1, name: 'Six weeks ahead' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'This week' })).toContainText('Payday')
  await expect(page.getByRole('region', { name: 'Next week' })).toContainText(LONG_TRIP)
  await expect(page.getByRole('region', { name: 'Next week' })).toContainText('to set aside')
  await expect(page.getByText(LONG_EVENT)).toBeVisible()
  // Events left out of the read are noted above the weeks.
  await expect(page.getByRole('status').filter({ hasText: LEFT_OUT })).toBeVisible()
  // Weeks with nothing in them fold into one quiet line.
  await expect(page.getByText(/^Nothing due .+ to .+\.$/)).toHaveCount(1)
  // A bill opens its own form; an event, a purchase to save for it.
  await page.getByRole('link', { name: /Renters insurance/ }).click()
  await expect(page).toHaveURL(/\/payday\/bills\?bill=b1$/)
  await page.goBack()
  await page.getByRole('link', { name: new RegExp(LONG_EVENT) }).click()
  await expect(page.getByRole('form', { name: 'New purchase' })).toBeVisible()
  // The purchase is named by the event's kind, never its title, which can
  // hold a person's name.
  await expect(page.getByLabel('What are you saving for?')).toHaveValue('Wedding')
  // A trip in the weeks is saved for on its page, by its budget, not by a second goal.
  await page.goBack()
  const nextWeek = page.getByRole('region', { name: 'Next week' })
  await nextWeek.getByRole('link', { name: new RegExp(LONG_TRIP) }).click()
  await expect(page).toHaveURL(new RegExp(`${SOON_TRIP_PATH}$`))
  // A trip, recent or coming, opens its own page from the trips below the weeks.
  await page.goBack()
  await page
    .getByRole('region', { name: 'Trips' })
    .getByRole('link', { name: new RegExp(LONG_TRIP) })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: LONG_TRIP })).toBeVisible()
  await expect(page.getByRole('region', { name: 'By part' })).toContainText('Getting there')
  await expect(page.getByRole('form', { name: 'Plan a trip budget' })).toBeVisible()
})

test('a trip budget before you go is planned on the trip’s page', async ({ page }) => {
  // A trip comes only from a linked calendar, which is stood in for, so the
  // plan is caught on its way to the server rather than saved.
  await pretendCalendar(page)
  const planned: unknown[] = []
  await page.route('**/api/actions/create_trip_budget', async (route) => {
    planned.push(route.request().postDataJSON())
    await route.fulfill({ json: { result: { id: 'g1' } } })
  })
  await page.goto(SOON_TRIP_PATH)
  const form = page.getByRole('form', { name: 'Plan a trip budget' })
  await form.getByRole('textbox', { name: 'Name' }).fill('Long weekend in Santa Fe')
  await form.getByRole('textbox', { name: 'Getting there' }).fill('300')
  await form.getByRole('textbox', { name: 'Place to stay' }).fill('450')
  await form.getByRole('textbox', { name: 'Food per day' }).fill('60')
  await expect(form).toContainText('$1,290 in all')
  await form.getByRole('button', { name: 'Save budget' }).click()
  await expect
    .poll(() => planned)
    .toEqual([
      {
        name: 'Long weekend in Santa Fe',
        ...SOON_TRIP,
        travelCents: 30000,
        stayCents: 45000,
        foodPerDayCents: 6000,
        activitiesCents: 0,
      },
    ])
})
