// Where the owner types a question. Enter sends it; Shift+Enter starts a new line.

import type { KeyboardEvent } from 'react'
import { Icon } from '../../components/ui'

/** The longest question the server takes. */
export const QUESTION_MAX_LENGTH = 2000

export function Composer({
  draft,
  setDraft,
  send,
  busy,
}: {
  draft: string
  setDraft: (draft: string) => void
  send: (question: string) => void
  busy: boolean
}) {
  const ready = draft.trim().length > 0 && !busy
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (ready) send(draft)
  }
  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) send(draft)
      }}
    >
      <textarea
        className="chat-input"
        aria-label="Your question"
        placeholder="Ask about your money"
        rows={1}
        maxLength={QUESTION_MAX_LENGTH}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="chat-send" aria-label="Send" disabled={!ready}>
        <Icon name="send" size={20} />
      </button>
    </form>
  )
}
