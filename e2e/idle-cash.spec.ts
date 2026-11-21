// Spare cash on Plan, Bills: the server's answer, and the card that says it,
// with the savings rate it assumes, opening the math behind it.

import { expect, test } from '@playwright/test'
import { fakeSpareCash } from './idleCash'
import { action } from './seed'

test('the server answers with the rate it assumes, and never as an order to move money', async ({
  request,
}) => {
  const idle = await action<{ suggested: boolean; apyPercent: number; idleCents: number }>(
    request,
    'get_idle_cash',
  )
  expect(idle.apyPercent).toBe(4)
  expect(typeof idle.suggested).toBe('boolean')
  expect(idle.idleCents % 10_000).toBe(0)
})

test('spare cash shows on Plan, Bills, and opens its math', async ({ page }) => {
  await fakeSpareCash(page)
  await page.goto('/plan/bills')
  const card = page.getByRole('region', { name: 'Spare cash' })
  await expect(card).toContainText("isn't needed before payday")
  await expect(card).toContainText('In savings at 4% APY')
  await card.getByRole('button').click()
  const drill = page.getByRole('dialog', { name: 'Spare cash in checking' })
  await expect(drill).toContainText('Could sit in savings')
  await expect(drill).toContainText('Leeway never moves money')
})
