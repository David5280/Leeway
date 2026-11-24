// Goals in order: each lands in a month when one monthly amount fills them one
// after another, and moving one up says plainly what it did to the dates.

import { expect, test } from '@playwright/test'
import {
  CAR,
  namesInOrder,
  orderNames,
  setUpOrder,
  swapped,
  tearDownOrder,
  TRIP,
} from './goal-order'

test.beforeEach(async ({ page }) => setUpOrder(page))
test.afterEach(async ({ page }) => tearDownOrder(page))

test('goals are ranked with up and down, and the dates follow', async ({ page }) => {
  await page.goto('/goals')
  const card = page.getByRole('region', { name: 'Which goal comes first?' })
  await expect(card).toContainText(
    'Your $300 a month goes to the top goal until it’s done, then the next.',
  )
  const list = card.getByRole('list', { name: 'Goals in order' })
  await expect(list.getByRole('listitem').filter({ hasText: TRIP })).toContainText(
    /Lands \w{3} \d{4}/,
  )

  // The car was added last; one tap moves it ahead of the trip.
  const before = await namesInOrder(page)
  expect(before.indexOf(CAR)).toBe(before.indexOf(TRIP) + 1)
  await card.getByRole('button', { name: `Move ${CAR} up` }).click()
  await expect(card.getByRole('status')).toContainText(`${CAR} now lands`)
  await expect(card.getByRole('status')).toContainText(`${TRIP} now lands`)
  const after = swapped(before, CAR, TRIP)
  await expect(orderNames(page)).toHaveText(after)

  // The order is kept.
  await page.reload()
  await expect(orderNames(page)).toHaveText(after)

  // A new monthly amount moves every date.
  await card.getByRole('button', { name: 'Change' }).click()
  await card
    .getByRole('textbox', { name: 'How much can you put toward goals each month?' })
    .fill('600')
  await card.getByRole('button', { name: 'Save' }).click()
  await expect(card).toContainText('Your $600 a month')
})
