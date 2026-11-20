// Chat: ask about your money in your own words, like "Can I afford a PS5 Pro
// right now?". Only there when the server has an Anthropic key; otherwise
// its address leads back to Overview.

import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useChatAvailable } from '../api/chat'
import { useAction, useActionMutation } from '../api/hooks'
import { Shell } from '../components/Shell'
import { ErrorNote, Loading, LoadingOrError } from '../components/ui'
import { Composer } from './chat/Composer'
import { Conversation } from './chat/Conversation'
import { Remembered } from './chat/Remembered'
import { Starters } from './chat/Starters'
import { useAsk } from './chat/useAsk'

/** Past this share of the day's allowance, Chat says how much is used. */
const ALLOWANCE_NOTE_AT = 0.75

function StartOver() {
  const clear = useActionMutation('clear_chat')
  const [sure, setSure] = useState(false)
  if (!sure) {
    return (
      <button type="button" className="btn small ghost" onClick={() => setSure(true)}>
        Start over
      </button>
    )
  }
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="small muted">Delete this conversation?</span>
      <button
        type="button"
        className="btn small"
        disabled={clear.isPending}
        onClick={() => clear.mutate({}, { onSuccess: () => setSure(false) })}
      >
        Delete
      </button>
      <button type="button" className="btn small ghost" onClick={() => setSure(false)}>
        Keep
      </button>
    </div>
  )
}

function ChatScreen() {
  const chat = useAction('get_chat')
  const [draft, setDraft] = useState('')
  const { pending, error, ask } = useAsk(setDraft)
  const end = useRef<HTMLDivElement>(null)
  const count = chat.data?.messages.length ?? 0
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [count, pending?.question])

  if (!chat.data) return <LoadingOrError error={chat.error} />
  const { messages, facts, allowance } = chat.data
  const send = (question: string) => {
    setDraft('')
    ask(question)
  }
  const used = allowance.usedTokens / allowance.limitTokens
  const empty = messages.length === 0 && !pending

  return (
    <div className="chat">
      <header className="row-between chat-head">
        <div>
          <p className="eyebrow">Chat</p>
          <h1>Ask Leeway</h1>
        </div>
        {messages.length > 0 && !pending && <StartOver />}
      </header>
      {empty ? (
        <Starters ask={send} busy={pending !== null} />
      ) : (
        <Conversation messages={messages} pending={pending} />
      )}
      {error?.limit && <p className="notice">{error.message}</p>}
      {error && !error.limit && <ErrorNote error={new Error(error.message)} />}
      <Composer draft={draft} setDraft={setDraft} send={send} busy={pending !== null} />
      {used >= ALLOWANCE_NOTE_AT && (
        <p className="small muted">
          Chat has used {Math.min(100, Math.round(used * 100))}% of today&apos;s allowance.
        </p>
      )}
      <Remembered facts={facts} />
      <div ref={end} />
    </div>
  )
}

export function ChatPage() {
  const available = useChatAvailable()
  if (available === false) return <Navigate to="/" replace />
  return <Shell>{available ? <ChatScreen /> : <Loading />}</Shell>
}
