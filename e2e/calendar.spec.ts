// The calendar stays out of the way until linked, a link is checked before
// anything is saved, and the weeks ahead show what is coming. No real
// calendar can be reached from the tests, so a linked one, and a calendar
// that does not answer, are stood in for (calendar.ts).

import { expect, test } from '@playwright/test'
import { calendarNotAnswering, LONG_EVENT, LONG_TRIP, pretendCalendar } from './calendar'
import { action } from './seed'

test('with no calendar linked, it is one quiet entry in Settings and nowhere else', async ({
  page,
}) => {
  await page.goto('/')
  // Ready first: the hero and every widget loaded, so an absence below means something.
  await expect(page.getByRole('region', { name: 'Your leeway' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByText(/calendar|coming up/i)).toHaveCount(0)
  await expect(page.getByRole('link', { name: /calendar/i })).toHaveCount(0)
  // Plan offers Coming up only once the calendar's status is in, so wait for it.
  const status = page.waitForResponse('**/api/actions/calendar_status')
  await page.goto('/plan')
  await status
  await expect(page.getByRole('button', { name: 'Bills' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Coming up' })).toHaveCount(0)
  await page.goto('/settings/calendar')
  await expect(page.getByRole('button', { name: 'Connect a calendar' })).toBeDisabled()
})

test('a calendar link is checked before anything is saved', async ({ page }) => {
  await page.goto('/settings/calendar')
  const link = page.getByRole('textbox', { name: 'Calendar link' })
  await link.fill('http://calendar.example.com/basic.ics')
  await page.getByRole('button', { name: 'Connect a calendar' }).click()
  await expect(page.getByRole('alert')).toHaveText(/secure calendar link/)
  // A calendar that does not answer is said plainly, and the address is not repeated back.
  await calendarNotAnswering(page)
  await link.fill('https://calendar.example.com/private-abc123/basic.ics')
  await page.getByRole('button', { name: 'Connect a calendar' }).click()
  await expect(page.getByRole('alert')).toHaveText(/did not answer/)
  await expect(page.getByText('private-abc123')).toHaveCount(0)
  expect(await action(page.request, 'calendar_status')).toMatchObject({ connected: false })
})

test('the weeks ahead show paydays, bills and events from the calendar', async ({ page }) => {
  await pretendCalendar(page)
  await page.goto('/plan/ahead')
  await expect(page.getByRole('button', { name: 'Coming up' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('region', { name: 'This week' })).toContainText('Payday')
  await expect(page.getByRole('region', { name: 'Next week' })).toContainText(LONG_TRIP)
  await expect(page.getByRole('region', { name: 'Next week' })).toContainText('to set aside')
  await expect(page.getByText(LONG_EVENT)).toBeVisible()
  // Weeks with nothing in them fold into one quiet line.
  await expect(page.getByText(/^Nothing due .+ to .+\.$/)).toHaveCount(1)
  // A bill opens its own form; an event, a purchase to save for it.
  await page.getByRole('link', { name: /Renters insurance/ }).click()
  await expect(page).toHaveURL(/\/plan\/bills\?bill=b1$/)
  await page.goBack()
  await page.getByRole('link', { name: new RegExp(LONG_TRIP) }).click()
  await expect(page.getByRole('form', { name: 'New purchase' })).toBeVisible()
  await expect(page.getByLabel('What are you saving for?')).toHaveValue(LONG_TRIP)
})
