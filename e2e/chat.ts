// Helpers for Chat. The browser tests run with no Anthropic key, so Chat is
// hidden for real, and no model can ever be called. To see it on, Chat's
// actions and its stream are stood in for at the network: get_chat_status
// says it is on, get_chat answers from what the stand-in keeps, and a
// question is answered with a fixed stream of server-sent events.

import { expect, type Page } from '@playwright/test'

/** A question and its answer, long enough to wrap on every phone. */
export const QUESTION = 'Can I afford a PS5 Pro right now?'
export const ANSWER = [
  'Yes. A PS5 Pro costs about $700, and you have $1,240 left before payday after the bills due by then.',
  'It would not touch the money set aside for your goals, and Groceries stays inside its budget.',
].join('\n\n')

/** What the owner told Leeway to remember, as the stand-in starts with. */
const FACTS = [
  { text: 'Saving for a wedding in June 2027' },
  { text: 'Paid twice a month, on the 15th and the last day' },
]

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}

const event = (data: { type: string } & Record<string, unknown>) =>
  `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`

/**
 * Turns Chat on for this page. With `conversation`, it opens with one
 * question already answered; otherwise it opens empty, with its starters.
 */
export async function pretendChatOn(page: Page, conversation = false): Promise<void> {
  const at = new Date().toISOString()
  const message = (id: number, role: Message['role'], text: string): Message => ({
    id: String(id),
    role,
    text,
    createdAt: at,
  })
  let messages: Message[] = conversation
    ? [message(1, 'user', QUESTION), message(2, 'assistant', ANSWER)]
    : []
  let facts = FACTS.map((fact, n) => ({
    id: `00000000-0000-4000-8000-00000000000${n + 1}`,
    createdAt: at,
    ...fact,
  }))
  const result = (value: unknown) => ({ json: { result: value } })
  await page.route('**/api/actions/get_chat_status', (route) =>
    route.fulfill(result({ available: true })),
  )
  await page.route('**/api/actions/get_chat', (route) =>
    route.fulfill(
      result({
        available: true,
        answering: false,
        messages,
        facts,
        allowance: { usedTokens: 12_000, limitTokens: 600_000, resetsOn: '2026-12-01' },
      }),
    ),
  )
  await page.route('**/api/actions/clear_chat', (route) => {
    messages = []
    return route.fulfill(result({ cleared: true }))
  })
  await page.route('**/api/actions/forget_fact', (route) => {
    const { id } = route.request().postDataJSON() as { id: string }
    facts = facts.filter((fact) => fact.id !== id)
    return route.fulfill(result({ forgotten: id }))
  })
  await page.route('**/api/chat', (route) => {
    const { message: text } = route.request().postDataJSON() as { message: string }
    const question = message(messages.length + 1, 'user', text)
    const answer = message(messages.length + 2, 'assistant', ANSWER)
    messages = [...messages, question, answer]
    return route.fulfill({
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: [
        event({ type: 'tool', title: 'Checking the purchase' }),
        event({ type: 'text', text: ANSWER }),
        event({ type: 'done', question, answer }),
      ].join(''),
    })
  })
}

/** Opens Chat, which pretendChatOn must have turned on, and waits for it. */
export async function openChat(page: Page): Promise<void> {
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: 'Ask Leeway' })).toBeVisible()
}

/** Asks the PS5 question from the starters and waits for the kept answer. */
export async function askStarter(page: Page): Promise<void> {
  await page.getByRole('button', { name: QUESTION }).click()
  await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible()
  const log = page.getByRole('list', { name: 'Conversation' })
  await expect(log.getByText(/^Yes\. A PS5 Pro costs about \$700/)).toBeVisible()
}
