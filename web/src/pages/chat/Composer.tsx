// Where the owner types a question. Enter sends it; Shift+Enter starts a new line.

import type { KeyboardEvent, Ref } from 'react'
import { Icon } from '../../components/ui'

/** The longest question the server takes. */
export const QUESTION_MAX_LENGTH = 2000

export function Composer({
  draft,
  setDraft,
  send,
  busy,
  inputRef,
  placeholder = 'Ask about your money',
}: {
  draft: string
  setDraft: (draft: string) => void
  send: (question: string) => void
  busy: boolean
  /** The box itself, so Chat can move focus to it. */
  inputRef?: Ref<HTMLTextAreaElement>
  /** What the empty box says; Ask Leeway names the screen, like "Ask about Payday". */
  placeholder?: string
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
        ref={inputRef}
        className="chat-input"
        aria-label="Your question"
        placeholder={placeholder}
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
