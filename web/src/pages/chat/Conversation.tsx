// The conversation in Chat: the owner's questions on the right, Leeway's
// answers on the left, and the answer still arriving at the end.

import type { Output } from '../../api/client'
import type { Pending } from './useAsk'

type Message = Output<'get_chat'>['messages'][number]

function Question({ text }: { text: string }) {
  return (
    <li className="chat-line from-owner">
      <p className="chat-bubble">{text}</p>
    </li>
  )
}

function Answer({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <li className="chat-line from-leeway">
      <p className="chat-answer" aria-live={live ? 'polite' : undefined}>
        {text}
      </p>
    </li>
  )
}

/** What Leeway is doing before its first words: looking something up, or thinking. */
function Working({ tool }: { tool: string | null }) {
  return (
    <li className="chat-line from-leeway">
      <p className="chat-working" role="status">
        <span className="chat-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {tool ? `${tool}…` : 'Thinking…'}
      </p>
    </li>
  )
}

export function Conversation({
  messages,
  pending,
}: {
  messages: readonly Message[]
  pending: Pending | null
}) {
  return (
    <ol className="chat-log" aria-label="Conversation">
      {messages.map((message) =>
        message.role === 'user' ? (
          <Question key={message.id} text={message.text} />
        ) : (
          <Answer key={message.id} text={message.text} />
        ),
      )}
      {pending && (
        <>
          <Question text={pending.question} />
          {pending.text && <Answer text={pending.text} live />}
          {(!pending.text || pending.tool) && <Working tool={pending.tool} />}
        </>
      )}
    </ol>
  )
}
