// Ask Leeway's test screens: any address in the shell with a field to type
// in and the address shown, the full Chat page at /chat, and a fake server
// that answers Chat's actions and keeps every question sent.

import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import type { ChatEvent, ScreenContext } from '../api/chat'
import type { Output } from '../api/client'
import { Shell } from '../components/Shell'
import { ChatPage } from '../pages/Chat'
import { fakeServer, renderSignedIn, type FakeServer, type Handlers } from './fake'
import { windowOf, type Size } from './frames'

type ChatView = Output<'get_chat'>
type Message = ChatView['messages'][number]

/** A conversation as get_chat gives it, empty unless given messages. */
export function chatView(messages: Message[] = []): ChatView {
  return {
    available: true,
    answering: false,
    messages,
    facts: [],
    allowance: { usedTokens: 0, limitTokens: 600_000, resetsOn: '2026-11-21' },
  }
}

/** One message of a conversation. */
export function message(id: string, role: Message['role'], text: string): Message {
  return { id, role, text, createdAt: '2026-11-20T18:00:00.000Z' }
}

/** A finished answer, as the stream sends it. */
export function answered(question: string, answer: string): Response {
  const done: ChatEvent = {
    type: 'done',
    question: message('q', 'user', question),
    answer: message('a', 'assistant', answer),
  }
  return new Response(`event: done\ndata: ${JSON.stringify(done)}\n\n`)
}

/** An answer still streaming, sent a piece at a time by the test: `response` goes to the fake server. */
export function answerStream() {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream({ start: (c) => void (controller = c) }))
  const send = (event: ChatEvent) =>
    controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
  return {
    response,
    /** Sends a piece of the answer's text. */
    text: (text: string) => act(() => send({ type: 'text', text })),
    /** Finishes the answer, as the server does once it is kept. */
    done: (question: string, answer: string) =>
      act(() => {
        send({
          type: 'done',
          question: message('q', 'user', question),
          answer: message('a', 'assistant', answer),
        })
        controller.close()
      }),
  }
}

/** Shows where the router is, as the address bar would, and hands its navigate to the test. */
function Address({ onNavigate }: { onNavigate: (navigate: NavigateFunction) => void }) {
  const { pathname } = useLocation()
  onNavigate(useNavigate())
  return <output aria-label="Address">{pathname}</output>
}

export interface AskOptions {
  /** Whether the server has an AI key. */
  chat?: boolean
  /** The window's size; a phone unless given. */
  size?: Size
  /** The conversation so far. */
  messages?: Message[]
  /** Drawn inside the screen, under its heading. */
  children?: ReactNode
  /**
   * Draws a new frame for each address, as the app's pages each draw their
   * own <Shell>; otherwise one frame stays across addresses.
   */
  shellPerPage?: boolean
  /** How the server answers a question; a finished "Fine." unless given. */
  answer?: (question: string) => Response
}

/** The screen at every address: one frame, or a new one per address with `shellPerPage`. */
function Screen({ shellPerPage, children }: { shellPerPage: boolean; children: ReactNode }) {
  const { pathname } = useLocation()
  return <Shell key={shellPerPage ? pathname : undefined}>{children}</Shell>
}

/**
 * Renders the shell at `route` with Ask Leeway's fake server. Returns the
 * server, the questions sent to /api/chat (with their context), a way to
 * press the browser's Back button, and one to resize the window.
 */
export function renderAsk(route = '/payday', options: AskOptions = {}) {
  const {
    chat = true,
    size = { width: 390, height: 844 },
    messages = [],
    children,
    shellPerPage = false,
    answer = (question: string) => answered(question, 'Fine.'),
  } = options
  const resize = windowOf(size)
  const asked: { message: string; context?: ScreenContext }[] = []
  const handlers: Handlers = {
    count_notifications: () => ({ unread: 0 }),
    get_chat_status: () => ({ available: chat }),
    get_chat: () => chatView(messages),
  }
  const server: FakeServer = fakeServer(handlers, {
    '/api/chat': () => {
      const body = server.calls.at(-1)!.body as { message: string; context?: ScreenContext }
      asked.push(body)
      return answer(body.message)
    },
  })
  let navigate: NavigateFunction = () => {}
  const screen = (
    <Screen shellPerPage={shellPerPage}>
      <h1>A screen</h1>
      <input aria-label="Note" />
      <Address onNavigate={(next) => (navigate = next)} />
      {children}
    </Screen>
  )
  const result = renderSignedIn(
    <Routes>
      <Route path="/chat" element={<ChatPage />} />
      <Route path="*" element={screen} />
    </Routes>,
    { route },
  )
  const back = () => act(() => void navigate(-1))
  return { ...result, server, asked, back, resize }
}
