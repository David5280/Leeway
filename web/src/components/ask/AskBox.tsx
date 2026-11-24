// Ask Leeway's box: the conversation in a good-sized box anchored to the
// corner its button sits in (AskFab.tsx). A small header names it and
// closes it; the conversation scrolls above the question field.
//
// It is not modal: the page under it stays in view and usable, with no dim
// layer and no scroll lock. A press outside it, Escape or its close button
// shrinks it back into the button (so does following a link in an answer,
// pages/chat/AnswerText.tsx). Closing never stops an answer on its way.

import { useId, type KeyboardEvent } from 'react'
import { ChatThread } from '../../pages/chat/ChatThread'
import { Icon, Logo } from '../ui'
import type { AskControls } from './AskProvider'
import { takesFocus, useOutsidePress } from './useOutsidePress'

/** What the empty field says, naming the screen: "Ask about Payday". */
export function askPrompt(screen: string): string {
  return `Ask about ${screen}`
}

export function AskBox({ ask, leaving }: { ask: AskControls; leaving: boolean }) {
  const titleId = useId()
  // A press on something that takes focus (a field, a tab) keeps it; anywhere else, focus returns to the button.
  const outside = useOutsidePress(!leaving, (target) => ask.close({ refocus: !takesFocus(target) }))

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    ask.close()
  }

  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      className="ask-box"
      data-state={leaving ? 'closing' : 'open'}
      // While it plays its way out it can be neither reached nor read.
      inert={leaving}
      aria-hidden={leaving || undefined}
      onKeyDown={onKeyDown}
      {...outside}
    >
      <header className="ask-box-head">
        <h2 id={titleId} className="ask-box-title">
          <Logo size={22} />
          Ask Leeway
        </h2>
        <button
          type="button"
          className="ask-box-close"
          aria-label="Close Ask Leeway"
          onClick={() => ask.close()}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <ChatThread docked keptScroll={ask.boxScroll} placeholder={askPrompt(ask.screen)} />
    </section>
  )
}
