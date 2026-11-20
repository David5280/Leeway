// The pure parts of Chat: which tools it has, what it is told, which past
// messages go with a question, the answer kept when the model stops, and
// what a tool's output looks like on its way to the model.

import { describe, expect, it } from 'vitest'
import {
  chatEnding,
  CUT_OFF,
  DECLINED,
  historyFor,
  HISTORY_MAX_CHARS,
  joinSteps,
  NO_ANSWER,
} from '../src/chat/answer.js'
import { CHAT_SYSTEM, chatContext } from '../src/chat/prompt.js'
import { chatToolText } from '../src/chat/toolOutput.js'
import { CHAT_TOOLS, chatToolList, toolTitle } from '../src/chat/tools.js'
import { estimateChatTokens, FRAMING_TOKENS, type AiChatAsk } from '../src/domain/ai/gateway.js'
import type { ChatMessage } from '../src/domain/chat/store.js'

const message = (role: ChatMessage['role'], text: string, id = '1'): ChatMessage => ({
  id,
  role,
  text,
  createdAt: '2026-11-17T18:00:00.000Z',
})

describe("Chat's tools", () => {
  it('can read everything an assistant can, and change nothing but what it remembers', () => {
    const names = CHAT_TOOLS.map((tool) => tool.name)
    expect(names).toContain('get_checkin')
    expect(names).toContain('list_transactions')
    for (const tool of CHAT_TOOLS) {
      if (tool.name !== 'remember') expect(tool.scope).toBe('read')
    }
    expect(names.filter((name) => /^(create|update|delete|set|sync|import)_/.test(name))).toEqual(
      [],
    )
  })

  it('answers a purchase through one tool, the place the fuller answer plugs in', () => {
    const names = CHAT_TOOLS.map((tool) => tool.name)
    expect(names).toContain('check_purchase')
    expect(names).not.toContain('can_i_afford')
    expect(names).not.toContain('when_can_i_afford')
  })

  it('describes each tool with a JSON schema of its input, in a fixed order', () => {
    const list = chatToolList()
    expect(list.map((tool) => tool.name)).toEqual(CHAT_TOOLS.map((tool) => tool.name))
    const purchase = list.find((tool) => tool.name === 'check_purchase')!
    expect(purchase.inputSchema).toMatchObject({
      type: 'object',
      properties: { amountCents: { type: 'integer' } },
      required: ['amountCents'],
    })
    expect(JSON.stringify(chatToolList())).toBe(JSON.stringify(list))
  })

  it('names each tool for the owner while it runs', () => {
    expect(toolTitle('get_checkin')).toBe('Money check-in')
    expect(toolTitle('no_such_tool')).toBeNull()
  })
})

describe('what Chat is told', () => {
  it('keeps the fixed instructions free of anything that changes', () => {
    expect(CHAT_SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(CHAT_SYSTEM).toContain('check_purchase')
    expect(CHAT_SYSTEM).toContain('remember')
  })

  it('gives the day, the currency and what to keep in mind', () => {
    expect(chatContext('2026-11-20', 'EUR', [])).toBe(
      "Today is Friday, 2026-11-20. The owner's currency is EUR.\nThe owner has not asked you to remember anything yet.",
    )
    const facts = [
      { id: 'a', text: 'Paid twice a month', createdAt: '2026-11-02T09:00:00.000Z' },
      { id: 'b', text: 'Wedding in June 2027', createdAt: '2026-11-19T09:00:00.000Z' },
    ]
    expect(chatContext('2026-11-20', 'USD', facts)).toBe(
      [
        "Today is Friday, 2026-11-20. The owner's currency is USD.",
        'What the owner told you to keep in mind:',
        '- Paid twice a month (saved 2026-11-02)',
        '- Wedding in June 2027 (saved 2026-11-19)',
      ].join('\n'),
    )
  })
})

describe('the history sent with a question', () => {
  it('sends the latest messages that fit, starting with a question', () => {
    const long = 'x'.repeat(HISTORY_MAX_CHARS - 10)
    const history = historyFor([
      message('user', 'Old question'),
      message('assistant', long),
      message('user', 'Recent'),
      message('assistant', 'Answer'),
    ])
    // The long answer still fits, but a conversation can't open with an answer.
    expect(history).toEqual([
      { role: 'user', text: 'Recent' },
      { role: 'assistant', text: 'Answer' },
    ])
  })

  it('sends nothing before the first question', () => {
    expect(historyFor([])).toEqual([])
  })
})

describe('the answer kept', () => {
  it('joins the steps a paragraph apart, leaving out steps with no words', () => {
    expect(joinSteps([' Let me look. ', '', 'You have room.'])).toBe(
      'Let me look.\n\nYou have room.',
    )
  })

  it('is the words of a finished answer, or a plain line when there were none', () => {
    expect(chatEnding('done', ' All good. ')).toBe('All good.')
    expect(chatEnding('done', '')).toBe(NO_ANSWER)
  })

  it('says why it ends early, after whatever was written', () => {
    expect(chatEnding('refused', '')).toBe(DECLINED)
    expect(chatEnding('cut_off', 'First,')).toBe(`First,\n\n${CUT_OFF}`)
    expect(chatEnding('cut_off', '', 'Too long.')).toBe('Too long.')
  })
})

describe("a tool's output for Chat", () => {
  it('leaves out bank text, account masks and every person paid or paying', () => {
    const result = {
      transactions: [
        {
          id: 't1',
          displayName: 'To Jane Doe',
          name: 'Zelle payment to JANE DOE 4417',
          merchantName: null,
          amountCents: 5000,
          person: { app: 'Zelle', direction: 'out', counterparty: 'Jane Doe' },
        },
      ],
      accounts: [{ name: 'Checking', mask: '4417' }],
      note: 'You sent jane doe $50; Janet is someone else.',
      at: new Date('2026-11-17T00:00:00Z'),
    }
    const text = chatToolText(result, ['Jane', 'Jane Doe', ' '])
    expect(JSON.parse(text)).toEqual({
      transactions: [
        {
          id: 't1',
          displayName: 'To someone',
          amountCents: 5000,
          person: { app: 'Zelle', direction: 'out', counterparty: null },
        },
      ],
      accounts: [{ name: 'Checking' }],
      note: 'You sent someone $50; Janet is someone else.',
      at: '2026-11-17T00:00:00.000Z',
    })
  })

  it('matches a name with accents or symbols as a whole word', () => {
    expect(chatToolText({ who: 'From Zoë (Zo) Ruiz, ZoëRuiz' }, ['Zoë (Zo) Ruiz'])).toBe(
      JSON.stringify({ who: 'From someone, ZoëRuiz' }, null, 2),
    )
  })
})

describe('the most a Chat step can send', () => {
  it('counts every byte of its instructions, context, tools and messages', () => {
    const ask: AiChatAsk = {
      system: 'abc',
      context: 'déjà',
      tools: [],
      messages: [{ role: 'user', text: 'hi' }],
      effort: 'low',
      maxTokens: 100,
    }
    const bytes = 3 + 6 + '[]'.length + JSON.stringify(ask.messages).length
    expect(estimateChatTokens(ask)).toBe(FRAMING_TOKENS + bytes)
  })
})
