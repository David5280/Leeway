// The calendar stays out of the way until linked, a link is checked before
// anything is saved, the weeks ahead show what is coming and open a trip,
// and a trip budget becomes one goal. No real calendar can be reached from
// the tests, so a linked one is stood in for (calendar.ts).

import { expect, test } from '@playwright/test'
import { daysFromNow, LONG_EVENT, LONG_TRIP, pretendCalendar } from './calendar'
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

test('the weeks ahead show paydays, bills and events, and open a trip', async ({ page }) => {
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
  await page.getByRole('region', { name: 'Next week' }).getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1, name: LONG_TRIP })).toBeVisible()
  await expect(page.getByRole('region', { name: 'By part' })).toContainText('Getting there')
  await expect(page.getByRole('form', { name: 'Plan a trip budget' })).toBeVisible()
})

test('a trip budget before you go becomes one goal', async ({ page }) => {
  const startsOn = daysFromNow(40)
  const endsOn = daysFromNow(43)
  await page.goto(`/trips/${startsOn}/${endsOn}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Travel' })).toBeVisible()
  const form = page.getByRole('form', { name: 'Plan a trip budget' })
  await form.getByRole('textbox', { name: 'Name' }).fill('Long weekend in Santa Fe')
  await form.getByRole('textbox', { name: 'Getting there' }).fill('300')
  await form.getByRole('textbox', { name: 'Place to stay' }).fill('450')
  await form.getByRole('textbox', { name: 'Food per day' }).fill('60')
  await expect(form).toContainText('$990 in all')
  await form.getByRole('button', { name: 'Make it a goal' }).click()

  // The trip now has its budget, and Plan has the goal.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Long weekend in Santa Fe' }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'By part' })).toContainText('$990 left of $990')
  const goals = await action<{ id: string; name: string; targetCents: number }[]>(
    page.request,
    'list_goals',
  )
  const goal = goals.find((g) => g.name === 'Long weekend in Santa Fe')!
  expect(goal).toMatchObject({ targetCents: 99000, targetDate: startsOn, setAside: true })
  // Leave the install as the other tests expect it.
  await action(page.request, 'delete_goal', { id: goal.id })
})
