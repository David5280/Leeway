// The Chat screens the phone layout guard checks (guarded-screens.ts). Chat is
// hidden without an Anthropic key, so it is turned on by stand-ins (chat.ts):
// the full Chat page before the first question and with an answer and what
// Leeway remembers, then Ask Leeway on a screen of its own: the bar above
// the tabs, which every page leaves room for, and the conversation open over
// the screen.

import { open, type Screen } from './screen'
import { pretendChatOn } from './chat'

/** A Chat screen, named for what it shows. */
const chatScreen = (name: string, more: Pick<Screen, 'before' | 'then'>): Screen => ({
  name: `/chat ${name}`,
  route: 'chat',
  path: () => '/chat',
  ...more,
})

/** Payday with Ask Leeway on, named for what it shows. */
const askScreen = (name: string, more: Pick<Screen, 'then'> = {}): Screen => ({
  name: `/payday ${name}`,
  route: 'payday',
  path: () => '/payday',
  before: (page) => pretendChatOn(page, true),
  ...more,
})

export const CHAT_SCREENS: Screen[] = [
  chatScreen('before the first question', { before: pretendChatOn }),
  chatScreen('with an answer and what Leeway remembers', {
    before: (page) => pretendChatOn(page, true),
    then: (page) => page.getByText('Leeway remembers 2 things').click(),
  }),
  askScreen('with the Ask Leeway bar'),
  askScreen('asking Leeway over the screen', {
    then: open(/^Ask Leeway: /, (page) => page.getByRole('dialog', { name: 'Ask Leeway' })),
  }),
]
