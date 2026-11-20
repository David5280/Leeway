// Chat on a desktop. With no Anthropic key, as the test server runs, Chat is
// hidden for real: no header button, no way in from Overview, and its address
// leads home. Turned on by stand-ins (chat.ts), it is reached from Overview,
// answers a starter as a stream, remembers, forgets and starts over.

import { expect, test } from '@playwright/test'
import { askStarter, openChat, pretendChatOn } from './chat'

test('is hidden entirely without an AI key', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('link', { name: 'Chat' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Ask about your money/ })).toHaveCount(0)

  await page.goto('/chat')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Ask Leeway' })).toHaveCount(0)
})

test('with a key, it is a tap from Overview and answers a starter', async ({ page }) => {
  await pretendChatOn(page)
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Chat' })).toBeVisible()
  await page.getByRole('link', { name: /Ask about your money/ }).click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByRole('heading', { name: 'Ask anything about your money' })).toBeVisible()

  await askStarter(page)
  const log = page.getByRole('list', { name: 'Conversation' })
  await expect(log.getByText('Can I afford a PS5 Pro right now?')).toBeVisible()

  // What it remembers can be read and forgotten.
  await page.getByText('Leeway remembers 2 things').click()
  await page.getByRole('button', { name: 'Forget: Saving for a wedding in June 2027' }).click()
  await expect(page.getByText('Leeway remembers 1 thing')).toBeVisible()

  // Starting over asks first, then brings the starters back.
  await page.getByRole('button', { name: 'Start over' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(
    page.getByRole('button', { name: 'Can I afford a PS5 Pro right now?' }),
  ).toBeVisible()
})

test('a typed question goes with Enter', async ({ page }) => {
  await pretendChatOn(page)
  await openChat(page)
  const asked = page.waitForRequest('**/api/chat')
  await page.getByRole('textbox', { name: 'Your question' }).fill('What bills are due this week?')
  await page.keyboard.press('Enter')
  expect((await asked).postDataJSON()).toEqual({ message: 'What bills are due this week?' })
  await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible()
})
