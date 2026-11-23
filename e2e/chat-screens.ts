// The Chat screens the phone layout guard checks (guarded-screens.ts). Chat is
// hidden without an Anthropic key, so it is turned on by stand-ins (chat.ts):
// before the first question, and with an answer and what Leeway remembers.

import type { Screen } from './guarded-screens'
import { pretendChatOn } from './chat'

/** A Chat screen, named for what it shows. */
const chatScreen = (name: string, more: Pick<Screen, 'before' | 'then'>): Screen => ({
  name: `/chat ${name}`,
  route: 'chat',
  path: () => '/chat',
  ...more,
})

export const CHAT_SCREENS: Screen[] = [
  chatScreen('before the first question', { before: pretendChatOn }),
  chatScreen('with an answer and what Leeway remembers', {
    before: (page) => pretendChatOn(page, true),
    then: (page) => page.getByText('Leeway remembers 2 things').click(),
  }),
]
