// Chat: hidden without an AI key, the starters, a streamed answer, failures,
// what Leeway remembers, and starting over.

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askChat, readEvents, STOPPED, type ChatEvent } from '../api/chat'
import type { Output } from '../api/client'
import { Shell } from '../components/Shell'
import { fakeServer, renderSignedIn, type Handlers } from '../test/fake'
import { ChatPage, STILL_ANSWERING } from './Chat'

afterEach(() => vi.unstubAllGlobals())

type ChatView = Output<'get_chat'>
type Message = ChatView['messages'][number]

const AT = '2026-11-20T18:00:00.000Z'
const message = (id: string, role: Message['role'], text: string): Message => ({
  id,
  role,
  text,
  createdAt: AT,
})

const FACT = {
  id: '7b1f5d1e-2f56-4a8e-9a43-3f1c2a8f0b11',
  text: 'Saving for a trip',
  createdAt: AT,
}

function chatView(fields: Partial<ChatView> = {}): ChatView {
  return {
    available: true,
    answering: false,
    messages: [],
    facts: [],
    allowance: { usedTokens: 0, limitTokens: 600_000, resetsOn: '2026-11-21' },
    ...fields,
  }
}

/** What the fake server keeps between requests. */
interface Kept {
  view: ChatView
}

/** Handlers for Chat's actions, keeping the conversation and facts as the server would. */
function chatHandlers(initial: ChatView = chatView(), available = true, kept?: Kept): Handlers {
  const state = kept ?? { view: initial }
  return {
    get_chat_status: () => ({ available }),
    get_chat: () => state.view,
    clear_chat: () => {
      state.view = { ...state.view, messages: [] }
      return { cleared: true }
    },
    forget_fact: ({ id }) => {
      state.view = { ...state.view, facts: state.view.facts.filter((fact) => fact.id !== id) }
      return { forgotten: id }
    },
  }
}

const sse = (event: ChatEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

/** A stream the test feeds an event at a time. */
function liveStream() {
  let push: (text: string) => void = () => {}
  let end: () => void = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      push = (text) => controller.enqueue(encoder.encode(text))
      end = () => controller.close()
    },
  })
  return {
    response: () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    send: (event: ChatEvent) => push(sse(event)),
    end: () => end(),
  }
}

function renderChat(handlers: Handlers, routes: Record<string, () => Response> = {}) {
  const server = fakeServer(handlers, routes)
  renderSignedIn(
    <Routes>
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/" element={<p>Overview page</p>} />
    </Routes>,
    { route: '/chat' },
  )
  return server
}

describe('Chat without an AI key', () => {
  it('has no way in from the header', async () => {
    fakeServer(chatHandlers(chatView(), false))
    const { client } = renderSignedIn(<Shell>Page</Shell>)
    // Once the answer has landed, not merely been asked for.
    await waitFor(() =>
      expect(client.getQueryData(['action', 'get_chat_status', {}])).toEqual({ available: false }),
    )
    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument()
  })

  it('sends its address back to Overview', async () => {
    const server = renderChat(chatHandlers(chatView(), false))
    expect(await screen.findByText('Overview page')).toBeInTheDocument()
    expect(server.actions('get_chat')).toHaveLength(0)
  })

  it('stays hidden when the server cannot say', async () => {
    renderChat({})
    expect(await screen.findByText('Overview page')).toBeInTheDocument()
  })
})

describe('Chat with an AI key', () => {
  it('is reached from the Ask Leeway bar, not a link in the header', async () => {
    fakeServer(chatHandlers())
    renderSignedIn(<Shell>Page</Shell>)
    expect(await screen.findByRole('button', { name: /^Ask Leeway/ })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument()
  })

  it('starts with what it does and questions to tap', async () => {
    renderChat(chatHandlers())
    expect(
      await screen.findByRole('heading', { name: 'Ask anything about your money' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Can I afford a PS5 Pro right now?' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
  })

  it('streams the answer, saying what it looks at first', async () => {
    const stream = liveStream()
    const kept = { view: chatView() }
    const server = renderChat(chatHandlers(kept.view, true, kept), { '/api/chat': stream.response })
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Can I afford a PS5 Pro right now?' }),
    )
    expect(server.calls.find((call) => call.path === '/api/chat')?.body).toEqual({
      message: 'Can I afford a PS5 Pro right now?',
    })
    const log = screen.getByRole('list', { name: 'Conversation' })
    expect(within(log).getByText('Can I afford a PS5 Pro right now?')).toBeVisible()
    expect(within(log).getByRole('status')).toHaveTextContent('Thinking…')

    stream.send({ type: 'tool', title: 'Checking the purchase' })
    expect(await within(log).findByText('Checking the purchase…')).toBeVisible()
    stream.send({ type: 'text', text: 'Yes, it ' })
    stream.send({ type: 'text', text: 'fits.' })
    expect(await within(log).findByText('Yes, it fits.')).toBeVisible()
    expect(within(log).queryByRole('status')).not.toBeInTheDocument()

    const question = message('1', 'user', 'Can I afford a PS5 Pro right now?')
    const answer = message('2', 'assistant', 'Yes, it fits.')
    kept.view = { ...kept.view, messages: [question, answer] }
    stream.send({ type: 'done', question, answer })
    stream.end()
    expect(await screen.findByRole('button', { name: 'Start over' })).toBeVisible()
    expect(within(log).getAllByText('Yes, it fits.')).toHaveLength(1)
  })

  it('sends what is typed with Enter, keeping Shift+Enter for a new line', async () => {
    const stream = liveStream()
    const server = renderChat(chatHandlers(), { '/api/chat': stream.response })
    const user = userEvent.setup()
    const box = await screen.findByRole('textbox', { name: 'Your question' })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.type(box, 'How am I{Shift>}{Enter}{/Shift}doing?{Enter}')
    expect(server.calls.find((call) => call.path === '/api/chat')?.body).toEqual({
      message: 'How am I\ndoing?',
    })
    expect(box).toHaveValue('')
  })

  it('sends with the Send button too', async () => {
    const stream = liveStream()
    const server = renderChat(chatHandlers(), { '/api/chat': stream.response })
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Your question' }), 'Any bills?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(server.calls.find((call) => call.path === '/api/chat')?.body).toEqual({
      message: 'Any bills?',
    })
  })

  it('hands a failed question back to send again', async () => {
    const stream = liveStream()
    renderChat(chatHandlers(), { '/api/chat': stream.response })
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Your question' }), 'Hello?{Enter}')
    stream.send({ type: 'error', message: 'Chat is busy right now.' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Chat is busy right now.')
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('Hello?')
  })

  it('says plainly, not as a problem, when the day is used up', async () => {
    renderChat(chatHandlers(), {
      '/api/chat': () =>
        Response.json(
          { error: 'ai_limit', message: "Chat has used today's allowance." },
          { status: 429 },
        ),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'How am I doing this month?' }))
    expect(await screen.findByText("Chat has used today's allowance.")).toHaveClass('notice')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says how much of the day is used once most of it is', async () => {
    const allowance = { usedTokens: 480_000, limitTokens: 600_000, resetsOn: '2026-11-21' }
    renderChat(chatHandlers(chatView({ allowance })))
    expect(await screen.findByText("Chat has used 80% of today's allowance.")).toBeVisible()
  })

  it('shows what it remembers, and forgets on request', async () => {
    const other = { ...FACT, id: '0b8c7a52-91d4-4c1e-8f0e-6a2d1f3b4c5d', text: 'Paid weekly' }
    const server = renderChat(chatHandlers(chatView({ facts: [FACT, other] })))
    const user = userEvent.setup()
    await user.click(await screen.findByText('Leeway remembers 2 things'))
    await user.click(screen.getByRole('button', { name: 'Forget: Saving for a trip' }))
    expect(server.actions('forget_fact')).toEqual([{ id: FACT.id }])
    expect(await screen.findByText('Leeway remembers 1 thing')).toBeVisible()
    expect(screen.queryByText('Saving for a trip')).not.toBeInTheDocument()
  })

  it('starts over only once asked twice', async () => {
    const messages = [message('1', 'user', 'Hi'), message('2', 'assistant', 'Hello.')]
    const server = renderChat(chatHandlers(chatView({ messages })))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(server.actions('clear_chat')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('button', { name: /PS5 Pro/ })).toBeVisible()
    expect(server.actions('clear_chat')).toHaveLength(1)
  })
})

describe('Chat while an answer is on its way', () => {
  const question = message('1', 'user', 'How am I doing?')
  const answer = message('2', 'assistant', 'You are on track.')

  /**
   * get_chat as the server gives it while it finishes a question asked
   * before: answering once, then the kept exchange.
   */
  function stillAnswering(first: ChatView): Handlers {
    let view = first
    return {
      ...chatHandlers(),
      get_chat: () => {
        const now = view
        if (now.answering) view = chatView({ messages: [question, answer] })
        return now
      },
    }
  }

  it('waits for an answer it left partway, saying so plainly, until it lands', async () => {
    renderChat(stillAnswering(chatView({ answering: true })))
    expect(await screen.findByText(STILL_ANSWERING)).toHaveClass('notice')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'How am I doing this month?' })).toBeDisabled()
    // Read again until the answer is kept.
    expect(await screen.findByText('You are on track.', {}, { timeout: 4000 })).toBeVisible()
    expect(screen.queryByText(STILL_ANSWERING)).not.toBeInTheDocument()
  })

  it('takes a question refused for one still being answered as a wait, not a problem', async () => {
    const handlers = stillAnswering(chatView({ answering: true }))
    let refusals = 0
    renderChat(
      {
        ...handlers,
        get_chat: (input) =>
          // The page's first read finds nothing under way; after the refusal, it does.
          refusals === 0 ? chatView() : handlers.get_chat!(input),
      },
      {
        '/api/chat': () => {
          refusals += 1
          return Response.json(
            { error: 'conflict', message: 'Leeway is still answering your last question.' },
            { status: 409 },
          )
        },
      },
    )
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Your question' }), 'Bills?{Enter}')
    expect(await screen.findByText(STILL_ANSWERING)).toHaveClass('notice')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The question is handed back to send again once the answer is in.
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('Bills?')
    expect(await screen.findByText('You are on track.', {}, { timeout: 4000 })).toBeVisible()
  })

  it('drops an exchange the owner started over elsewhere while it was answered', async () => {
    const stream = liveStream()
    renderChat(chatHandlers(), { '/api/chat': stream.response })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'How am I doing this month?' }))
    stream.send({ type: 'text', text: 'You are' })
    expect(await screen.findByText('You are')).toBeVisible()
    stream.send({ type: 'cleared' })
    stream.end()
    expect(
      await screen.findByRole('heading', { name: 'Ask anything about your money' }),
    ).toBeVisible()
    expect(screen.queryByText('You are')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Chat for every reader', () => {
  const scrolls = vi.fn()
  beforeEach(() => {
    scrolls.mockClear()
    Element.prototype.scrollIntoView = scrolls
  })
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  it('marks the log busy while it streams, and announces the finished answer once', async () => {
    const stream = liveStream()
    const kept = { view: chatView() }
    renderChat(chatHandlers(kept.view, true, kept), { '/api/chat': stream.response })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'What bills are coming up?' }))
    const log = screen.getByRole('list', { name: 'Conversation' })
    expect(log).toHaveAttribute('aria-busy', 'true')
    stream.send({ type: 'text', text: 'Rent is due Friday.' })
    expect(await within(log).findByText('Rent is due Friday.')).not.toHaveAttribute('aria-live')
    const live = document.querySelector('[aria-live="polite"]')!
    expect(live).toBeEmptyDOMElement()

    const question = message('1', 'user', 'What bills are coming up?')
    const answer = message('2', 'assistant', 'Rent is due Friday.')
    kept.view = { ...kept.view, messages: [question, answer] }
    stream.send({ type: 'done', question, answer })
    stream.end()
    await waitFor(() => expect(live).toHaveTextContent('Rent is due Friday.'))
    expect(log).toHaveAttribute('aria-busy', 'false')
    // The same element all along, so screen readers hear it.
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
  })

  it('follows the answer as it streams, unless the reader scrolled up', async () => {
    const stream = liveStream()
    renderChat(chatHandlers(), { '/api/chat': stream.response })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'What bills are coming up?' }))
    stream.send({ type: 'text', text: 'Rent ' })
    await screen.findByText('Rent')
    const followed = scrolls.mock.calls.length
    stream.send({ type: 'text', text: 'is due.' })
    await screen.findByText('Rent is due.')
    expect(scrolls.mock.calls.length).toBeGreaterThan(followed)

    // Scrolled up: the end is far below the screen, so it stays put.
    const end = document.querySelector('.chat')!.lastElementChild!
    vi.spyOn(end, 'getBoundingClientRect').mockReturnValue({ top: 5_000 } as DOMRect)
    fireEvent.scroll(document)
    const before = scrolls.mock.calls.length
    stream.send({ type: 'text', text: ' Then power.' })
    await screen.findByText('Rent is due. Then power.')
    expect(scrolls.mock.calls.length).toBe(before)
  })

  it('keeps focus in the conversation through Start over', async () => {
    const messages = [message('1', 'user', 'Hi'), message('2', 'assistant', 'Hello.')]
    renderChat(chatHandlers(chatView({ messages })))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.getByRole('button', { name: 'Start over' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveFocus(),
    )
  })
})

describe('reading the stream', () => {
  it('reads whole events and keeps a cut one for the next piece', () => {
    const whole = sse({ type: 'text', text: 'Hi' })
    expect(readEvents(`${whole}event: text\ndata: {"ty`)).toEqual({
      events: [{ type: 'text', text: 'Hi' }],
      rest: 'event: text\ndata: {"ty',
    })
    expect(readEvents('event: ping\n\n').events).toEqual([])
  })

  it('says the answer stopped when the stream ends without one', async () => {
    fakeServer({}, { '/api/chat': () => new Response(sse({ type: 'text', text: 'Par' })) })
    const events: ChatEvent[] = []
    await askChat('Hi', (event) => events.push(event))
    expect(events).toEqual([
      { type: 'text', text: 'Par' },
      { type: 'error', message: STOPPED },
    ])
  })

  it('stops reading quietly once stopped partway', async () => {
    let fail: (error: Error) => void = () => {}
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse({ type: 'text', text: 'Par' })))
        fail = (error) => controller.error(error)
      },
    })
    fakeServer({}, { '/api/chat': () => new Response(body) })
    const stop = new AbortController()
    const events: ChatEvent[] = []
    await askChat(
      'Hi',
      (event) => {
        events.push(event)
        stop.abort()
        fail(new Error('aborted'))
      },
      stop.signal,
    )
    expect(events).toEqual([{ type: 'text', text: 'Par' }])
  })

  it('ends quietly when stopped, and says when the server cannot be reached', async () => {
    const stopped = new AbortController()
    stopped.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const events: ChatEvent[] = []
    await askChat('Hi', (event) => events.push(event), stopped.signal)
    expect(events).toEqual([])
    await expect(askChat('Hi', () => {})).rejects.toMatchObject({ code: 'unreachable' })
  })
})
