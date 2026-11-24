// Chat: ask about your money in your own words, like "Can I afford a PS5 Pro
// right now?". Only there when the server has an Anthropic key; otherwise
// its address leads back to Overview.

import { useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useChatAvailable } from '../api/chat'
import type { Output } from '../api/client'
import { useAction } from '../api/hooks'
import { Shell } from '../components/Shell'
import { ErrorNote, Loading, LoadingOrError } from '../components/ui'
import { Composer } from './chat/Composer'
import { Conversation } from './chat/Conversation'
import { Remembered } from './chat/Remembered'
import { Starters } from './chat/Starters'
import { StartOver } from './chat/StartOver'
import { useAsk, type Unanswered } from './chat/useAsk'
import { useFollowEnd } from './chat/useFollowEnd'

/** Past this share of the day's allowance, Chat says how much is used. */
const ALLOWANCE_NOTE_AT = 0.75

/** How often to look for an answer the server is still writing, in milliseconds. */
const ANSWER_POLL_MS = 1500

/** Said while the server finishes a question asked before (from another visit or tab). */
export const STILL_ANSWERING =
  'Still answering your last question. Its answer shows here once done.'

type ChatView = Output<'get_chat'>

/**
 * The conversation, read again every ANSWER_POLL_MS while the server is
 * still answering a question this page is not streaming, until it lands.
 */
function useConversation() {
  return useAction('get_chat', undefined, {
    refetchInterval: (query) => (query.state.data?.answering ? ANSWER_POLL_MS : false),
  })
}

/** How much of the day's allowance is used, once most of it is. */
function AllowanceNote({ allowance }: { allowance: ChatView['allowance'] }) {
  const used = allowance.usedTokens / allowance.limitTokens
  if (used < ALLOWANCE_NOTE_AT) return null
  return (
    <p className="small muted">
      Chat has used {Math.min(100, Math.round(used * 100))}% of today&apos;s allowance.
    </p>
  )
}

/**
 * Why there is no answer yet: plain notes for a wait (an answer still on its
 * way, or the day's allowance used up), red only for a real problem.
 */
function Notes({ elsewhere, error }: { elsewhere: boolean; error: Unanswered | null }) {
  return (
    <>
      {elsewhere && <p className="notice">{STILL_ANSWERING}</p>}
      {error?.limit && <p className="notice">{error.message}</p>}
      {error && !error.limit && <ErrorNote error={new Error(error.message)} />}
    </>
  )
}

function ChatScreen() {
  const chat = useConversation()
  const [draft, setDraft] = useState('')
  const { pending, error, finished, ask } = useAsk(setDraft)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  // Changes with each new message and each piece of streamed text.
  const progress = `${chat.data?.messages.length}:${pending?.question}:${pending?.text.length}`
  useFollowEnd(end, progress)

  if (!chat.data) return <LoadingOrError error={chat.error} />
  const { messages, facts, allowance } = chat.data
  // An answer the server is writing that this page is not streaming.
  const elsewhere = chat.data.answering && !pending
  const busy = pending !== null || chat.data.answering
  const send = (question: string) => {
    setDraft('')
    ask(question)
  }

  return (
    <div className="chat">
      <header className="row-between chat-head">
        <div>
          <p className="eyebrow">Chat</p>
          <h1>Ask Leeway</h1>
        </div>
        {messages.length > 0 && !busy && <StartOver onCleared={() => input.current?.focus()} />}
      </header>
      {messages.length === 0 && !pending ? (
        <Starters ask={send} busy={busy} />
      ) : (
        <Conversation messages={messages} pending={pending} />
      )}
      <Notes elsewhere={elsewhere} error={error} />
      <Composer draft={draft} setDraft={setDraft} send={send} busy={busy} inputRef={input} />
      <AllowanceNote allowance={allowance} />
      <Remembered facts={facts} />
      {/* One stable place that announces each finished answer, once. */}
      <p className="visually-hidden" aria-live="polite">
        {finished}
      </p>
      <div ref={end} />
    </div>
  )
}

export function ChatPage() {
  const available = useChatAvailable()
  if (available === false) return <Navigate to="/" replace />
  return <Shell>{available ? <ChatScreen /> : <Loading />}</Shell>
}
