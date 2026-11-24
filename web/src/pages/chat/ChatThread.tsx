// The conversation with Leeway, wherever it is shown: the full Chat page,
// the phone's sheet over a screen, or the computer's panel beside one. Its
// state lives in AskProvider, so all three are the same conversation and a
// question keeps streaming while the owner moves between screens.

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import type { Output } from '../../api/client'
import { useAction } from '../../api/hooks'
import { useAskTalk, type AskTalk } from '../../components/ask/AskProvider'
import { ErrorNote, Icon, LoadingOrError } from '../../components/ui'
import { Composer } from './Composer'
import { Conversation } from './Conversation'
import { Remembered } from './Remembered'
import { Starters } from './Starters'
import { StartOver } from './StartOver'
import type { Unanswered } from './useAsk'
import { useFollowEnd } from './useFollowEnd'

/** Past this share of the day's allowance, Chat says how much is used. */
const ALLOWANCE_NOTE_AT = 0.75

/** How often to look for an answer the server is still writing, in milliseconds. */
const ANSWER_POLL_MS = 1500

/**
 * How long the conversation read counts as fresh, in milliseconds. The
 * computer's panel is drawn anew on every tab, and this keeps a tab switch
 * from reading it again. A question asked here refreshes it at once
 * (useAsk.ts), so this only delays seeing one asked on another device.
 */
export const CONVERSATION_FRESH_MS = 5 * 60_000

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
    staleTime: CONVERSATION_FRESH_MS,
    refetchInterval: (query) => (query.state.data?.answering ? ANSWER_POLL_MS : false),
  })
}

/** Moves focus to the question box when asked to (the "/" key, a bar or a card), once it is drawn. */
function useTakeFocus(input: RefObject<HTMLTextAreaElement | null>, talk: AskTalk, drawn: boolean) {
  const { wantsFocus, focused } = talk
  useEffect(() => {
    if (!wantsFocus || !drawn) return
    // After every effect of this render, so a sheet focusing itself on open cannot take it back.
    queueMicrotask(() => input.current?.focus())
    focused()
  }, [wantsFocus, drawn, input, focused])
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

/** The card the next question is about, with a way to ask about the screen alone. */
function AboutCard({ talk }: { talk: AskTalk }) {
  if (!talk.about) return null
  const { label, figure } = talk.about
  return (
    <p className="ask-about">
      <span className="ask-about-text">
        About {label}
        {figure && <span className="muted"> · {figure}</span>}
      </span>
      <button
        type="button"
        className="ask-about-drop"
        aria-label={`Not about ${label}`}
        onClick={talk.forgetAbout}
      >
        <Icon name="close" size={14} />
      </button>
    </p>
  )
}

export function ChatThread({
  heading,
  placeholder,
}: {
  /** The page's own heading; the sheet and panel have theirs already. */
  heading?: ReactNode
  /** What the empty box says, like "Ask about Payday". */
  placeholder?: string
}) {
  const chat = useConversation()
  const talk = useAskTalk()
  const { draft, setDraft, pending, error, finished, ask } = talk
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  // Changes with each new message and each piece of streamed text.
  const progress = `${chat.data?.messages.length}:${pending?.question}:${pending?.text.length}`
  useFollowEnd(end, progress)
  useTakeFocus(input, talk, chat.data !== undefined)

  if (!chat.data) return <LoadingOrError error={chat.error} />
  const { messages, facts, allowance } = chat.data
  // An answer the server is writing that this page is not streaming.
  const elsewhere = chat.data.answering && !pending
  const busy = pending !== null || chat.data.answering
  const canStartOver = messages.length > 0 && !busy
  const send = (question: string) => {
    setDraft('')
    ask(question)
  }

  return (
    <div className="chat">
      {(heading || canStartOver) && (
        <header className="row-between chat-head">
          {heading ?? <span />}
          {canStartOver && <StartOver onCleared={() => input.current?.focus()} />}
        </header>
      )}
      {messages.length === 0 && !pending ? (
        <Starters ask={send} busy={busy} />
      ) : (
        <Conversation messages={messages} pending={pending} />
      )}
      <Notes elsewhere={elsewhere} error={error} />
      <AboutCard talk={talk} />
      <Composer
        draft={draft}
        setDraft={setDraft}
        send={send}
        busy={busy}
        inputRef={input}
        placeholder={placeholder}
      />
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
