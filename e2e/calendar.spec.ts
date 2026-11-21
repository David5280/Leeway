// The calendar stays out of the way until linked, a link is checked before
// anything is saved, and the weeks ahead show what is coming. No real
// calendar can be reached from the tests, so a linked one is stood in for
// (calendar.ts).

import { expect, test } from '@playwright/test'
import { LONG_EVENT, LONG_TRIP, pretendCalendar } from './calendar'
import { action } from './seed'

test('with no calendar linked, it is one quiet entry in Settings and nowhere else', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(/calendar/i)).toHaveCount(0)
  await page.goto('/plan')
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
  // A host that does not exist never answers; the address is not repeated back.
  await link.fill('https://calendar.invalid/private-abc123/basic.ics')
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
})
